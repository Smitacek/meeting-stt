# Meeting STT - Production Ready Real-time Transcription

🎉 **PRODUCTION READY** - Kompletní real-time speech-to-text aplikace s profesionálními features.

## ✨ Features

### 🎯 **Core Functionality**
- **Real-time Speech-to-Text** s Azure Speech SDK
- **Speaker Diarization** - automatické rozpoznání mluvčích
- **Unified Workflow** - Record mode (upload files) + Live mode (real-time)
- **Persistent History** - všechny transkripce se ukládají do Azure Storage Tables
- **Export Functionality** - download transkriptů jako .txt soubory

### 🎮 **Professional Controls**
- **Pause/Resume** během live nahrávání s intelligent session management
- **Time Limits** (5-180 minut) s automatickým ukončením při dosažení limitu
- **Progress Tracking** s real-time visual feedback a countdown
- **Audio Level Meter** s threshold detection a quality warnings

### 🔧 **Technical Excellence**
- **Modern Architecture**: Direct Azure Speech SDK integration
- **Scalable Storage**: Azure Storage Tables pro data persistence
- **Professional UI**: Real-time feedback, visual indicators, responsive design
- **Error Resilience**: Robust error handling s fallback mechanisms
- **Browser Compatibility**: Web Audio API s webkit support

---

🚀 **Deployment Ready**: 28. června 2025


# Prerequisites:

1. Install [Azure Developer CLI](https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd?tabs=winget-windows%2Cbrew-mac%2Cscript-linux&pivots=os-windows).
2. Ensure you have access to an Azure subscription
3. Docker - Follow the [official Docker installation instructions](https://docs.docker.com/get-started/get-docker/) - make sure your docker is loged in (docker login -u "username" -p "password"
 )
4. Python version >= 3.10, < 3.13
5. Install [UV](https://github.com/astral-sh/uv?tab=readme-ov-file#installation) - optional for running locally


# Step by step deployment
   
## 1. Clone the repository     
```bash  
git clone https://github.com/...  
```
## 2. Login to your Azure account
```bash
azd auth login
```
> You need to choose your preferred region (you can start with `westeurope`)

## 3. Deploy Azure Resources and the app

```bash
azd up
```


# Working locally  

There are two parts to this project: the backend and the frontend. The backend is written in Python, and the frontend is written in JavaScript using React.

## Backend

```bash  
cd backend  
```
Set up a virtual environment (Preferred)
```bash
uv venv
```
Once you’ve created a virtual environment, you may activate it.

On Windows, run:
```bash
.venv\Scripts\activate
```
On Unix or MacOS, run:
```bash
source .venv/bin/activate
```
To deactivate :
```bash
deactivate
```
> More information about virtual environments can be found [here](https://docs.python.org/3/tutorial/venv.html)

### Install dependencies
```bash
uv sync
```

### Run
```bash
uvicorn main:app --reload
```

## Frontend (open a new terminal)
```bash
cd frontend
```
### Install dependencies
```bash
npm install
```
> Update the env variables in sample.env and rename to .env

## Run
```bash
npm run dev
```
If your app is ready, you can browse to (typically) http://localhost:8501 to see the app in action.
![Screenshot](./assets/application.png)

# Learn
Check these resources:
- [Azure Container Apps Documentation](https://learn.microsoft.com/en-us/azure/container-apps/)
- [Azure OpenAI Service Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/openai/)
- [Azure Speech Service Documentation](https://learn.microsoft.com/en-us/azure/cognitive-services/speech-service/)
