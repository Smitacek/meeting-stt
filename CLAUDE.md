# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Meeting Speech-to-Text application that transcribes audio files using Azure Cognitive Services and provides analysis capabilities. The application consists of a Python FastAPI backend and React TypeScript frontend, deployed to Azure using Container Apps and Static Web Apps.

## Architecture

### Backend (`/backend`)
- **Framework**: FastAPI with Python 3.10-3.12
- **Main dependencies**: Azure Speech SDK, OpenAI, Azure Storage Blob, Azure Cosmos DB
- **Core functionality**: Audio transcription, analysis, history management, real-time speech-to-text
- **Key modules**:
  - `main.py`: FastAPI application entry point, includes `/live/token` endpoint for Azure Speech SDK
  - `utils/transcription.py`: Azure Speech Service integration
  - `utils/analyze.py`: AI-powered analysis using OpenAI
  - `utils/storage.py`: Azure Blob Storage handling
  - `utils/states.py`: Data classes for History, Transcription objects
  - `utils/audio.py`: Audio file processing and validation
  - `utils/transcription_live_direct.py`: Real-time transcription with Azure Speech (deprecated)
- **Environment variables required**: `AZURE_SPEECH_KEY`, `AZURE_SPEECH_ENDPOINT`, `AZURE_SPEECH_REGION`

### Frontend (`/frontend`)
- **Framework**: React 18 + TypeScript + Vite
- **UI Library**: Radix UI components with Tailwind CSS
- **Key features**: File upload, transcription display, history management, real-time speech-to-text
- **Routing**: React Router with pages: Playground (main), Introduction, History
- **State management**: React Context for user info and history
- **Real-time components**: 
  - `LiveRecordingSDKDiarization.tsx`: Modern Azure Speech SDK with speaker diarization
  - `LiveRecordingSDK.tsx`: Basic Azure Speech SDK implementation
  - `LiveRecordingStateless.tsx`: Previous HTTP chunking implementation (deprecated)
- **Unified UI**: Optimized workflow with mode switcher and merged steps:
  - **Record mode**: Step 1 (Choose method) → Step 2 (Upload & Transcribe) → Step 3 (Results) → Step 4 (Analysis)  
  - **Live mode**: Step 1 (Choose method) → Step 2 (Live Recording) → Step 3 (Results) → Step 4 (Analysis)

### Infrastructure (`/infra`)
- **Platform**: Azure using Bicep templates
- **Backend hosting**: Azure Container Apps
- **Frontend hosting**: Azure Static Web Apps
- **Storage**: Azure Blob Storage + Azure Cosmos DB
- **Deployment**: Azure Developer CLI (`azd`)

## Real-time Speech-to-Text Implementation

The application now supports real-time speech-to-text using Azure Speech SDK:

1. **Architecture**: Frontend connects directly to Azure Speech Service via WebSocket
2. **Authentication**: Backend provides temporary Azure Speech tokens via `/live/token`
3. **Requirements**: Azure Speech Service credentials must be configured in Container Apps
4. **Documentation**: See `docs/azure-speech-setup.md` for environment variable configuration

## Development Commands

### Backend Development
```bash
cd backend
uv venv                    # Create virtual environment
source .venv/bin/activate  # Activate on Unix/macOS
.venv\Scripts\activate     # Activate on Windows
uv sync                    # Install dependencies
uvicorn main:app --reload # Run development server (http://localhost:8000)
```

### Frontend Development
```bash
cd frontend
npm install               # Install dependencies
npm run dev              # Run development server (http://localhost:5173)
npm run build            # Build for production
npm run lint             # Run ESLint
npm run preview          # Preview production build
```

### Testing
- Backend: No formal test framework configured (only `test_audio_split.py`)
- Frontend: No test framework configured

### Deployment
```bash
azd auth login           # Login to Azure
azd up                   # Deploy entire application to Azure
```

## Backend-Frontend Communication

### API Architecture
- **Base URL**: Configured via `VITE_BASE_URL` environment variable
- **Development**: Frontend proxies `/chat` requests to `localhost:8000`
- **Production**: Direct communication with Azure Container App

### HTTP Libraries
- **axios**: Simple API calls (uploads, file listing)
- **fetch**: Streaming responses (transcription, analysis, live transcription)
- **FormData**: File uploads and parameter passing

### Key API Endpoints
```
POST /upload              # Local file upload (multipart/form-data)
POST /uploadfromblob      # Upload from Azure Blob Storage
GET  /loadfiles           # List available blob files
POST /submit              # Start transcription (streaming)
POST /submit_batch        # Batch transcription
POST /analyze             # AI analysis (streaming)
GET  /history             # Get history records
POST /history/create      # Create new history entry
POST /live/transcribe     # Stateless live transcription
GET  /live/status         # Live transcription service status
```

### Live Transcription Communication
- **Stateless approach**: Each audio chunk processed independently
- **Multiple replica friendly**: No session storage required
- **Direct upload**: Audio chunks sent via FormData to `/live/transcribe`
- **Azure Speech Service**: Real transcription with ConversationTranscriber
- **Audio conversion**: WebM/Opus to WAV using FFmpeg
- **Fallback system**: Mock transcription when Azure unavailable
- **Speaker diarization**: Real speaker detection via Azure Speech API

### Streaming Communication
- **Server-Sent Events (SSE)** for real-time updates (batch processing)
- **ReadableStream** processing on frontend
- Used for transcription progress and analysis results
- **Direct HTTP requests** for live transcription (stateless)

## Key Data Flow

### Batch Processing (File Upload)
1. **Audio Upload**: Users upload files via frontend (local or blob storage)
2. **Transcription**: Backend processes using Azure Speech Service with SSE streaming
3. **Storage**: Files in Azure Blob Storage, metadata in memory (History objects)
4. **Analysis**: Optional AI analysis with streaming results via OpenAI
5. **History**: Session-based tracking, API endpoints for CRUD operations

### Live Transcription (Real-time)
1. **Audio Capture**: Browser MediaRecorder captures microphone input (WebM/Opus)
2. **Chunking**: Audio split into 1.5s chunks, uploaded every 2s
3. **Audio Conversion**: FFmpeg converts WebM/Opus to 16kHz WAV for Azure Speech
4. **Azure Processing**: ConversationTranscriber with speaker diarization
5. **Stateless Results**: Immediate transcription response with speaker labels
6. **Fallback System**: Mock transcription when Azure/FFmpeg unavailable
7. **Real-time Display**: Results with confidence scores and service indicators

## History Management

The application tracks transcription history using Azure Storage Tables with in-memory fallback:
- `History` class: Contains session metadata and list of transcriptions
- `Transcription` class: Individual file transcription with metadata  
- **Storage**: Azure Storage Tables (persistent) with automatic fallback to in-memory storage
- **Persistence**: Data survives Container Apps restarts and supports multiple replicas
- Frontend: History page displays past transcriptions with detail modal

## Environment Variables

### Backend
- `AZURE_SPEECH_KEY`: Azure Speech Service key
- `AZURE_SPEECH_ENDPOINT`: Azure Speech Service endpoint
- `AZURE_STORAGE_ACCOUNT_NAME`: Storage account name for Azure Tables
- `AZURE_STORAGE_ACCOUNT_KEY`: Storage account key for Azure Tables
- `AZURE_STORAGE_ACCOUNT_ENDPOINT`: Storage account endpoint
- Additional Azure service credentials via DefaultAzureCredential

### Frontend
- `VITE_BASE_URL`: Backend API URL (auto-configured during deployment)
- `VITE_ALLWAYS_LOGGED_IN`: Development flag for authentication bypass

## Important Notes

- **Azure Tables Storage**: Persistent history storage with automatic table creation
- **In-memory Fallback**: Graceful fallback when Azure Tables unavailable
- Authentication is simplified with basic user_id/session_id tracking (no Azure AD)
- Audio files are processed through Azure Speech Service with optional diarization
- Live transcription requires FFmpeg for audio conversion (WebM/Opus → WAV)
- Fallback to mock transcription when Azure Speech Service unavailable
- Frontend proxy configuration routes `/chat` requests to backend during development
- All user communication should be in Czech per existing project instructions
- Live transcription works with multiple Azure Container App replicas (stateless)

## File Organization

- `/backend/utils/`: Core business logic modules
- `/frontend/src/pages/`: Main application pages
- `/frontend/src/components/`: Reusable UI components
- `/docs/`: Implementation documentation and summaries
- `/infra/`: Azure infrastructure as code