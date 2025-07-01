from fastapi import FastAPI, Depends, UploadFile, HTTPException, Query, File, Form, Body, WebSocket, WebSocketDisconnect

from fastapi.middleware.cors import CORSMiddleware
# from fastapi.security import OAuth2AuthorizationCodeBearer
# from azure.identity import DefaultAzureCredential, get_bearer_token_provider
# from azure.storage.blob import BlobServiceClient
# import schemas, utils.crud as crud
# from database import CosmosDB
import os
import uuid
from contextlib import asynccontextmanager
from fastapi.responses import StreamingResponse, Response
import json, asyncio
import logging

from datetime import datetime 
from typing import List
import time

# Import TranscriptionFactory
from utils.audio import inspect_wav, inspect_audio, convert_mp3_to_wav, inspect_mp3
from utils.transcription import TranscriptionFactory
from utils.transcription_batch import TranscriptionBatchFactory
from utils.analyze import AnalysisFactory
from utils.storage import StorageFactory
from utils.states import History, Transcription, Transcript_chunk
# from api_key_auth import ensure_valid_api_key

# API to upload files from blob storage by blob names
from pydantic import BaseModel
from fastapi import Body

class BlobNamesRequest(BaseModel):
    files: list[str]

session_data = {}


# Lifespan handler for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup code: initialize database and configure logging
    # app.state.db = None
    # app.state.db = CosmosDB()
    
    # Initialize history state
    app.state.history = []  # List to store History objects
    
    logging.basicConfig(level=logging.INFO,
                        format='%(levelname)s: %(asctime)s - %(message)s')
    print("Database initialized.")
    print("History state initialized.")
    yield
    # Shutdown code (optional)
    # Cleanup database connection
    app.state.db = None
    # Clear history state (don't set to None to avoid errors)
    # app.state.history = None

app = FastAPI(lifespan=lifespan)
# app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, dependencies=[Depends(ensure_valid_api_key)])
# Allow all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Import persistent storage
from utils.history_storage import get_history_storage

# Helper functions for history management (now using persistent storage)
def add_history_record(user_id: str, session_id: str, history_type: str = "transcription") -> History:
    """Create a new history record and store it persistently."""
    try:
        storage = get_history_storage()
        return storage.add_history_record(user_id, session_id, history_type)
    except Exception as e:
        logger = logging.getLogger("add_history_record")
        logger.error(f"Failed to create history record: {str(e)}")
        # Fallback to in-memory if storage fails
        history_id = str(uuid.uuid4())
        history_record = History(
            id=history_id,
            user_id=user_id,
            session_id=session_id,
            type=history_type
        )
        if not hasattr(app.state, 'history') or app.state.history is None:
            app.state.history = []
        app.state.history.append(history_record)
        return history_record

def add_transcription_to_history(history_id: str, transcription: Transcription) -> bool:
    """Add a transcription to an existing history record."""
    try:
        storage = get_history_storage()
        return storage.add_transcription_to_history(history_id, transcription)
    except Exception as e:
        logger = logging.getLogger("add_transcription_to_history")
        logger.error(f"Failed to add transcription to storage: {str(e)}")
        # Fallback to in-memory
        if hasattr(app.state, 'history') and app.state.history:
            for history_record in app.state.history:
                if history_record.id == history_id:
                    history_record.transcriptions.append(transcription)
                    return True
        return False

def get_history_by_id(history_id: str) -> History:
    """Get a history record by its ID."""
    try:
        storage = get_history_storage()
        return storage.get_history_by_id(history_id)
    except Exception as e:
        logger = logging.getLogger("get_history_by_id")
        logger.error(f"Failed to get history from storage: {str(e)}")
        # Fallback to in-memory
        if hasattr(app.state, 'history') and app.state.history:
            for history_record in app.state.history:
                if history_record.id == history_id:
                    return history_record
        return None

def update_transcription_in_history(history_id: str, transcription: Transcription) -> bool:
    """Update an existing transcription in the history record."""
    storage = get_history_storage()
    return storage.update_transcription(history_id, transcription)

def get_user_history(user_id: str, visible_only: bool = True) -> List[History]:
    """Get all history records for a specific user."""
    try:
        storage = get_history_storage()
        return storage.get_user_history(user_id, visible_only)
    except Exception as e:
        logger = logging.getLogger("get_user_history")
        logger.error(f"Failed to get user history from storage: {str(e)}")
        # Fallback to in-memory
        user_histories = []
        if hasattr(app.state, 'history') and app.state.history:
            for history_record in app.state.history:
                if history_record.user_id == user_id:
                    if not visible_only or history_record.visible:
                        user_histories.append(history_record)
        return user_histories

def get_session_history(session_id: str, visible_only: bool = True) -> List[History]:
    """Get all history records for a specific session."""
    try:
        storage = get_history_storage()
        return storage.get_session_history(session_id, visible_only)
    except Exception as e:
        logger = logging.getLogger("get_session_history")
        logger.error(f"Failed to get session history from storage: {str(e)}")
        # Fallback to in-memory
        session_histories = []
        if hasattr(app.state, 'history') and app.state.history:
            for history_record in app.state.history:
                if history_record.session_id == session_id:
                    if not visible_only or history_record.visible:
                        session_histories.append(history_record)
        return session_histories


def get_current_time():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@app.get("/health")
async def health_check():
    logger = logging.getLogger("health_check")
    logger.setLevel(logging.INFO)
    logger.info("Health check endpoint called")
    # print("Health check endpoint called")
    return {"status": "healthy"}

# API to list blobs in storage for frontend selection
@app.get("/loadfiles")
async def load_files():
    logger = logging.getLogger("load_files")
    logger.setLevel(logging.INFO)
    try:
        storage = StorageFactory()
        blobs = storage.list_blobs()
        logger.info(f"Found {len(blobs)} blobs in storage.")
        return {"files": blobs}
    except Exception as e:
        logger.error(f"Error listing blobs: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to list blobs from storage")
    


@app.post("/uploadfromblob")
async def upload_from_blob(request: BlobNamesRequest = Body(...)):
    logger = logging.getLogger("upload_from_blob")
    logger.setLevel(logging.INFO)
    file_infos = []
    storage = StorageFactory()
    for blob_name in request.files:
        logger.info(f"Downloading and processing blob: {blob_name}")
        try:
            temp_path = f"./data/upload_{os.path.basename(blob_name)}"
            storage.download_file(blob_name, temp_path)
            # Inspect the audio file type first
            try:
                audio_info = inspect_audio(temp_path)
            except Exception as e:
                audio_info = {"filetype": "unknown", "success": False, "message": str(e)}

            # If it's mp3, convert to wav and update temp_path
            if audio_info.get("filetype") == "mp3":
                try:
                    inspection_info = inspect_mp3(temp_path)
                except Exception as e:
                    audio_info["conversion_error"] = str(e)
            elif audio_info.get("filetype") == "wav":
                inspection_info = inspect_wav(temp_path)

            # Determine the filename to report (converted or original), only keep the filename, not the whole path
            converted_path = audio_info.get("converted_wav_path")
            if converted_path:
                result_filename = os.path.basename(converted_path)
            else:
                result_filename = os.path.basename(temp_path)
            file_infos.append({
                "filename": result_filename,
                "filename_original": os.path.basename(blob_name),
                "inspect": inspection_info,
                "filetype": audio_info.get("filetype"),
                "audio_type": audio_info
            })
        except Exception as err:
            logger.error(f"Error processing blob {blob_name}: {str(err)}")
            file_infos.append({
                "filename": os.path.basename(blob_name),
                "error": str(err)
            })
    return {"status": "success", "files": file_infos}


@app.post("/upload")
async def upload_files(indexName: str = Form(...), files: List[UploadFile] = File(...)):
    logger = logging.getLogger("upload_files")
    logger.setLevel(logging.INFO)
    logger.info(f"Received indexName: {indexName}")
    file_infos = []
    for file in files:
        logger.info(f"Uploading file: {file.filename}")
        try:
            # Save uploaded file to a temporary location
            temp_path = f"./data/upload_{file.filename}"
            contents = await file.read()
            with open(temp_path, "wb") as f_out:
                f_out.write(contents)
            # Inspect the audio file type first
            try:
                audio_info = inspect_audio(temp_path)
            except Exception as e:
                audio_info = {"filetype": "unknown", "success": False, "message": str(e)}

            # If it's mp3, convert to wav and update temp_path
            if audio_info.get("filetype") == "mp3":
                try:
                    # conv_result = convert_mp3_to_wav(temp_path)
                    # Update temp_path to point to the new wav file
                    # temp_path = conv_result["output"]
                    # audio_info["converted_to_wav"] = True
                    # audio_info["converted_wav_path"] = temp_path
                    inspection_info = inspect_mp3(temp_path)
                    
                except Exception as e:
                    audio_info["conversion_error"] = str(e)
            elif audio_info.get("filetype") == "wav":
                # audio_info["converted_to_wav"] = False
                # audio_info["converted_wav_path"] = None
                inspection_info = inspect_wav(temp_path)

            # Determine the filename to report (converted or original), only keep the filename, not the whole path
            converted_path = audio_info.get("converted_wav_path")
            if converted_path:
                result_filename = os.path.basename(converted_path)
            else:
                result_filename = os.path.basename(temp_path)
            file_infos.append({
                "filename": result_filename,
                "filename_original": os.path.basename(file.filename),
                "inspect": inspection_info,
                "filetype": audio_info.get("filetype"),
                "audio_type": audio_info
            })
        except Exception as err:
            logger.error(f"Error processing file {file.filename}: {str(err)}")
            file_infos.append({
                "filename": file.filename,
                "error": str(err)
            })
    return {"status": "success", "files": file_infos}


# Refactored: file is a string (filename), not UploadFile
@app.post("/submit")
async def submit_transcription(
    file_name: str = Form(...),
    file_name_original: str = Form(...),
    temperature: float = Form(...),
    diarization: str = Form(...),
    language: str = Form(...),
    combine: str = Form(...),
    user_id: str = Form(None),
    session_id: str = Form(None),
    model: str = Form(None),
):
    logger = logging.getLogger("submit_transcription")
    logger.setLevel(logging.INFO)
    logger.info(f"Received file: {file_name}")
    logger.info(f"Temperature: {temperature}, Diarization: {diarization}, Language: {language}, Combine: {combine}, User ID: {user_id}, Session ID: {session_id}, Model: {model}")

    try:
        # Use the provided file name as the path (assume it's in ./data or is a full path)
        if os.path.isabs(file_name):
            temp_path = file_name
        else:
            temp_path = f"./data/{file_name}"
        if not os.path.exists(temp_path):
            raise HTTPException(status_code=404, detail=f"File not found: {temp_path}")
        logger.info(f"Using file at path: {temp_path}")

        # Inspect the audio file type first
        try:
            audio_info = inspect_audio(temp_path)
            logger.info(f"Audio inspection result: {audio_info}")
        except Exception as e:
            audio_info = {"filetype": "unknown", "success": False, "message": str(e)}
            logger.error(f"Error inspecting audio file: {str(e)}")


        # If it's mp3, convert to wav and update temp_path
        if audio_info.get("filetype") == "mp3":
            try:
                conv_result = convert_mp3_to_wav(temp_path)
                temp_path = conv_result["output"]
                logger.info(f"Converted MP3 to WAV: {temp_path}")
            except Exception as e:
                audio_info["conversion_error"] = str(e)
                logger.error(f"Error converting MP3 to WAV: {str(e)}")
        elif audio_info.get("filetype") == "wav":
            logger.info("File is already in WAV format, no conversion needed.")
        else:
            raise HTTPException(status_code=400, detail="Unsupported audio format")
        
        if model == "msft":
            
            # After conversion to wav, check if stereo and convert to mono if needed
            from utils.audio import convert_stereo_wav_to_mono
            inspection_info = inspect_wav(temp_path)
            logger.info(f"Audio inspection info before mono check: {inspection_info}")
            if inspection_info.get("channels") == 2:
                logger.info(f"Converting stereo WAV to mono: {temp_path}")
                mono_result = convert_stereo_wav_to_mono(temp_path)
                logger.info(mono_result["message"])
                # Re-inspect after conversion
                inspection_info = inspect_wav(temp_path)
                logger.info(f"Audio inspection info after mono conversion: {inspection_info}")


            # Prepare the transcription factory with the saved file path
            factory = TranscriptionFactory(
                conversationfilename=temp_path,
                language=language,
                channels=int(inspection_info["channels"]),
                bits_per_sample=int(inspection_info["bits_per_sample"]),
                samples_per_second=int(inspection_info["samples_per_second"]),
            )
            logger.info("TranscriptionFactory initialized successfully.")
        elif model == "llm":
            
            inspection_info = inspect_wav(temp_path)
            logger.info(f"Audio inspection info for LLM: {inspection_info}")
        

            # Prepare the transcription factory with the saved file path
            factory = TranscriptionFactory(
                conversationfilename=temp_path,
                language=language,
                channels=int(inspection_info["channels"]),
                bits_per_sample=int(inspection_info["bits_per_sample"]),
                samples_per_second=int(inspection_info["samples_per_second"]),
            )
            logger.info("TranscriptionFactory initialized successfully.")

        
        elif model == "whisper":
            # Upload processed file to blob storage for batch transcription
            blob_url = None
            try:
                storage = StorageFactory()
                blob_name = f"{os.path.basename(temp_path)}"
                # Generate SAS token for read access (valid for 24 hours)
                blob_url = storage.upload_file(temp_path, blob_name, generate_sas=True, sas_expiry_hours=24)
                logger.info(f"Successfully uploaded file to blob storage with SAS token: {blob_url}")
            except Exception as e:
                logger.error(f"Failed to upload file to blob storage: {str(e)}")
                # Continue with local file processing for non-batch models

            factory = TranscriptionBatchFactory()


        # Create history record if user_id and session_id are provided
        history_record = None
        transcription_record = None
        if user_id and session_id:
            # Check if there's already a history record for this session
            existing_histories = get_session_history(session_id, visible_only=False)
            if existing_histories:
                # Use the most recent history record for this session
                history_record = existing_histories[-1]
                logger.info(f"Using existing history record: {history_record.id}")
            else:
                # Create a new history record
                history_record = add_history_record(user_id, session_id)
                logger.info(f"Created new history record: {history_record.id}")
            
            # Create transcription record
            transcription_record = Transcription(
                file_name=file_name,
                file_name_original=file_name_original,
                language=language,
                model=model,
                temperature=temperature,
                diarization=diarization,
                combine=combine,
                status="pending"
            )
            
            # Add transcription to history
            add_transcription_to_history(history_record.id, transcription_record)
            logger.info(f"Added transcription to history record: {history_record.id}")

        def event_stream():
            import queue
            q = queue.Queue()

            def callback(event_dict):
                # Update transcription record status and content if available
                if transcription_record:
                    if event_dict.get("event_type") == "transcribed":
                        # Create a transcript chunk from the event data
                        chunk = Transcript_chunk(
                            event_type=event_dict.get("event_type", "transcribed"),
                            session=event_dict.get("session"),
                            offset=event_dict.get("offset"),
                            duration=event_dict.get("duration"),
                            text=event_dict.get("text", ""),
                            speaker_id=event_dict.get("speaker_id"),
                            result_id=event_dict.get("result_id"),
                            filename=event_dict.get("filename", transcription_record.file_name),
                            language=transcription_record.language
                        )
                        transcription_record.transcript_chunks.append(chunk)
                        logger.info(f"Added transcript chunk with {len(event_dict.get('text', ''))} characters")
                    elif event_dict.get("event_type") == "transcript":
                        # Handle legacy transcript events that might contain full text
                        # Create a single chunk for backward compatibility
                        chunk = Transcript_chunk(
                            event_type="transcribed",
                            text=event_dict.get("text", ""),
                            filename=transcription_record.file_name,
                            language=transcription_record.language
                        )
                        transcription_record.transcript_chunks.append(chunk)
                        transcription_record.status = "completed"
                        logger.info("Updated transcription record with legacy transcript text")
                    elif event_dict.get("event_type") in ("closing", "session_stopped"):
                        if transcription_record.status == "pending":
                            transcription_record.status = "completed"
                        logger.info(f"Final transcription status: {transcription_record.status}")
                    elif event_dict.get("event_type") == "error":
                        transcription_record.status = "failed"
                        logger.error("Transcription failed, updated status")
                
                # logger.info(f"callback: Received event: {event_dict}")
                q.put(event_dict)

            import threading
            if model == "llm":
                if inspection_info.get("channels") == 2:
                    logger.info("Starting LLM transcription with stereo audio.")
                    t = threading.Thread(target=factory.conversation_transcription_llm_advanced, kwargs={"callback": callback})
                else:
                    logger.info("Starting LLM transcription with mono audio.")
                    t = threading.Thread(target=factory.conversation_transcription_llm, kwargs={"callback": callback})
            elif model == "whisper":
                logger.info("Starting Whisper transcription with batch factory.")
                if blob_url:
                    content_url = blob_url
                    logger.info(f"Using uploaded blob URL for Whisper transcription: {content_url}")
                else:
                    logger.warning("No blob URL available, falling back to local file processing")
                    # Fallback to a default URL or raise an error
                    raise HTTPException(status_code=500, detail="Failed to upload file to blob storage for batch transcription")
                t = threading.Thread(target=factory.transcribe_batch, kwargs={"content_url": content_url, "model": "whisper", "callback": callback})
            elif model == "msft":
                logger.info("Starting MSFT transcription.")
                t = threading.Thread(target=factory.conversation_transcription, kwargs={"callback": callback})
            else:
                logger.error(f"Invalid model specified: {model}")
                raise HTTPException(status_code=400, detail="Invalid model specified. Use 'llm', 'whisper', or 'msft'.")
            t.start()

            while True:
                logger.info("event_stream: Waiting for events...")
                event = q.get()
                # logger.info(f"event_stream: Received event: {event}")
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("event_type") in ("closing","session_stopped"):
                    logger.info("event_stream: Ending stream on session_stopped or closing event.")
                    break
            t.join()
            
            # Update transcription in history after completion
            if history_record and transcription_record:
                success = update_transcription_in_history(history_record.id, transcription_record)
                if success:
                    logger.info(f"Updated transcription in history record: {history_record.id}")
                else:
                    logger.error(f"Failed to update transcription in history record: {history_record.id}")

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    except Exception as e:
        logger.error(f"Error processing transcription: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to process transcription")

# Batch transcription endpoint
@app.post("/submit_batch")
async def submit_batch_transcription(
    contentUrls: List[str] = Form(...),
    language: str = Form(None),
    display_name: str = Form("My Transcription"),
    candidate_locales: List[str] = Form(None),
    channels: int = Form(None),
    bits_per_sample: int = Form(None),
    samples_per_second: int = Form(None),
    user_id: str = Form(None),
    session_id: str = Form(None),
):
    logger = logging.getLogger("submit_batch_transcription")
    logger.setLevel(logging.INFO)
    logger.info(f"Received batch contentUrls: {contentUrls}")
    logger.info(f"Language: {language}, Display Name: {display_name}, Candidate Locales: {candidate_locales}, Channels: {channels}, Bits/Sample: {bits_per_sample}, Sample Rate: {samples_per_second}")

    try:
        # Prepare the transcription factory
        factory = TranscriptionFactory(
            language=language,
            channels=channels,
            bits_per_sample=bits_per_sample,
            samples_per_second=samples_per_second,
        )

        def event_stream():
            import queue
            import threading
            q = queue.Queue()
            results_holder = {"results": None}

            def callback(event_dict):
                # Only put status events, not final results, until the end
                if event_dict.get("event_type") == "transcribed_batch":
                    results_holder["results"] = event_dict
                else:
                    q.put(event_dict)

            def run_batch():
                # Call the batch transcription
                _ = factory.conversation_transcription_batch(
                    contentUrls=contentUrls,
                    callback=callback,
                    locale=language,
                    display_name=display_name,
                    candidate_locales=candidate_locales,
                )
                # After completion, put the final event
                if results_holder["results"]:
                    q.put(results_holder["results"])
                else:
                    # If no results, send a failed event
                    q.put({"event_type": "transcribed_batch", "results": []})

            t = threading.Thread(target=run_batch)
            t.start()

            while True:
                event = q.get()
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("event_type") == "transcribed_batch":
                    break
            t.join()

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    except Exception as e:
        logger.error(f"Error processing batch transcription: {str(e)}")
        # raise HTTPException(status_code=500, detail="Failed to process batch transcription")



@app.post("/analyze")
async def analyze_transcript(
    transcript: str = Form(..., example="This is a sample transcript."),
    customPrompt: str = Form(None),
):
    """
    Analyze a transcript sent via POST. Expects transcript and optional customPrompt.
    Returns a simple analysis (e.g., word count, sentence count, keywords).
    """
    logger = logging.getLogger("analyze_transcript")
    logger.setLevel(logging.INFO)

    text = transcript
    if not text:
        raise HTTPException(status_code=400, detail="No transcript text provided.")
    
    try:
        af = AnalysisFactory()

        import queue
        import threading
        q = queue.Queue()

        def callback(event_dict):
            q.put(event_dict)

        def run_analysis():
            if customPrompt and customPrompt.strip():
                af.analyze_transcript(text, callback=callback, custom_prompt=customPrompt)
            else:
                af.analyze_transcript(text, callback=callback)

        t = threading.Thread(target=run_analysis)
        t.start()

        def event_stream():
            while True:
                event = q.get()
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("message") == "Query executed successfully":
                    break
            t.join()

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    except Exception as e:
        logger.error(f"Error initializing AnalysisFactory: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to initialize analysis factory")


# History Management Endpoints

@app.post("/history/create")
async def create_history_record(
    user_id: str = Form(...),
    session_id: str = Form(...),
    history_type: str = Form("transcription")
):
    """Create a new history record."""
    logger = logging.getLogger("create_history_record")
    logger.setLevel(logging.INFO)
    
    try:
        history_record = add_history_record(user_id, session_id, history_type)
        logger.info(f"Created history record with ID: {history_record.id}")
        return {
            "status": "success",
            "history_id": history_record.id,
            "message": "History record created successfully"
        }
    except Exception as e:
        logger.error(f"Error creating history record: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to create history record")

@app.get("/history/user/{user_id}")
async def get_user_history_endpoint(
    user_id: str,
    visible_only: bool = Query(True, description="Show only visible records")
):
    """Get all history records for a specific user."""
    logger = logging.getLogger("get_user_history")
    logger.setLevel(logging.INFO)
    
    try:
        histories = get_user_history(user_id, visible_only)
        logger.info(f"Found {len(histories)} history records for user {user_id}")
        return {
            "status": "success",
            "user_id": user_id,
            "count": len(histories),
            "histories": histories
        }
    except Exception as e:
        logger.error(f"Error retrieving user history: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve user history")

@app.get("/history/session/{session_id}")
async def get_session_history_endpoint(
    session_id: str,
    visible_only: bool = Query(True, description="Show only visible records")
):
    """Get all history records for a specific session."""
    logger = logging.getLogger("get_session_history")
    logger.setLevel(logging.INFO)
    
    try:
        histories = get_session_history(session_id, visible_only)
        logger.info(f"Found {len(histories)} history records for session {session_id}")
        return {
            "status": "success",
            "session_id": session_id,
            "count": len(histories),
            "histories": histories
        }
    except Exception as e:
        logger.error(f"Error retrieving session history: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve session history")

@app.get("/debug/storage-status")
async def debug_storage_status():
    """Debug endpoint to check storage configuration and status."""
    logger = logging.getLogger("debug_storage_status")
    
    try:
        storage = get_history_storage()
        
        # Check environment variables
        storage_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
        storage_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "***hidden***" if os.getenv("AZURE_STORAGE_ACCOUNT_KEY") else None)
        storage_endpoint = os.getenv("AZURE_STORAGE_ACCOUNT_ENDPOINT")
        
        return {
            "storage_mode": "azure_tables" if storage.use_azure_tables else "in_memory",
            "azure_storage_account_name": storage_name,
            "azure_storage_account_key_present": bool(os.getenv("AZURE_STORAGE_ACCOUNT_KEY")),
            "azure_storage_account_endpoint": storage_endpoint,
            "table_names": {
                "history": getattr(storage, 'history_table_name', None),
                "transcriptions": getattr(storage, 'transcription_table_name', None)
            } if storage.use_azure_tables else None,
            "memory_stats": {
                "history_count": len(getattr(storage, 'memory_history', {})),
                "transcription_count": len(getattr(storage, 'memory_transcriptions', {}))
            } if not storage.use_azure_tables else None
        }
    except Exception as e:
        logger.error(f"Error checking storage status: {str(e)}")
        return {
            "error": str(e),
            "storage_mode": "unknown"
        }

@app.post("/debug/test-storage")
async def debug_test_storage():
    """Test storage by creating a dummy history record."""
    logger = logging.getLogger("debug_test_storage")
    
    try:
        # Test creating a history record
        test_user_id = "test_user_" + str(int(time.time()))
        test_session_id = "test_session_" + str(int(time.time()))
        
        logger.info(f"Creating test history record for user: {test_user_id}")
        history_record = add_history_record(test_user_id, test_session_id, "test")
        
        # Test retrieving it
        retrieved = get_history_by_id(history_record.id)
        
        # Test listing
        storage = get_history_storage()
        all_histories = storage.get_all_history(visible_only=False, limit=5)
        
        return {
            "test_result": "success",
            "created_history": {
                "id": history_record.id,
                "user_id": history_record.user_id,
                "session_id": history_record.session_id
            },
            "retrieved_successfully": retrieved is not None,
            "total_histories": len(all_histories)
        }
    except Exception as e:
        logger.error(f"Storage test failed: {str(e)}")
        return {
            "test_result": "failed",
            "error": str(e)
        }

@app.get("/history/{history_id}")
async def get_history_record(history_id: str):
    """Get a specific history record by ID."""
    logger = logging.getLogger("get_history_record")
    logger.setLevel(logging.INFO)
    
    try:
        history_record = get_history_by_id(history_id)
        if not history_record:
            raise HTTPException(status_code=404, detail="History record not found")
        
        logger.info(f"Retrieved history record: {history_id}")
        return {
            "status": "success",
            "history": history_record
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving history record: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve history record")

@app.put("/history/{history_id}/visibility")
async def toggle_history_visibility(
    history_id: str,
    visible: bool = Form(...)
):
    """Toggle the visibility of a history record."""
    logger = logging.getLogger("toggle_history_visibility")
    logger.setLevel(logging.INFO)
    
    try:
        logger.info(f"Attempting to toggle visibility for history_id: {history_id}, visible: {visible}")
        
        # Use persistent storage to toggle visibility
        storage = get_history_storage()
        logger.info(f"Got storage instance: {type(storage)}")
        
        success = storage.toggle_history_visibility(history_id, visible)
        logger.info(f"Toggle operation result: {success}")
        
        if not success:
            logger.warning(f"History record {history_id} not found")
            raise HTTPException(status_code=404, detail="History record not found")
        
        logger.info(f"Successfully updated visibility for history record {history_id} to {visible}")
        return {
            "status": "success",
            "history_id": history_id,
            "visible": visible,
            "message": "History visibility updated successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating history visibility: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to update history visibility: {str(e)}")

@app.get("/history")
async def get_all_history(
    visible_only: bool = Query(True, description="Show only visible records"),
    limit: int = Query(100, description="Maximum number of records to return")
):
    """Get all history records (with optional filtering)."""
    logger = logging.getLogger("get_all_history")
    logger.setLevel(logging.INFO)
    
    try:
        # Use persistent storage
        storage = get_history_storage()
        histories = storage.get_all_history(visible_only, limit)
        
        logger.info(f"Retrieved {len(histories)} history records from persistent storage")
        return {
            "status": "success",
            "count": len(histories),
            "histories": histories
        }
    except Exception as e:
        logger.error(f"Error retrieving all history: {str(e)}")
        # Fallback to in-memory storage
        try:
            logger.warning("Falling back to in-memory storage")
            histories = app.state.history if app.state.history else []
            if visible_only:
                histories = [h for h in histories if h.visible]
            histories = histories[:limit]
            
            return {
                "status": "success",
                "count": len(histories),
                "histories": histories,
                "fallback_mode": True
            }
        except:
            raise HTTPException(status_code=500, detail="Failed to retrieve history records")

@app.get("/debug/history")
async def debug_history():
    """Debug endpoint to check history state."""
    return {
        "history_type": str(type(app.state.history)),
        "history_count": len(app.state.history) if app.state.history else 0,
        "history_is_none": app.state.history is None,
        "history_preview": app.state.history[:3] if app.state.history else []
    }

@app.post("/history/{history_id}/transcription/{transcription_index}/analysis")
async def add_analysis_to_transcription(
    history_id: str,
    transcription_index: int,
    analysis_text: str = Form(...)
):
    """Add analysis results to a specific transcription in a history record."""
    logger = logging.getLogger("add_analysis_to_transcription")
    logger.setLevel(logging.INFO)
    
    try:
        history_record = get_history_by_id(history_id)
        if not history_record:
            raise HTTPException(status_code=404, detail="History record not found")
        
        if transcription_index >= len(history_record.transcriptions) or transcription_index < 0:
            raise HTTPException(status_code=400, detail="Invalid transcription index")
        
        history_record.transcriptions[transcription_index].analysis = analysis_text
        logger.info(f"Added analysis to transcription {transcription_index} in history {history_id}")
        
        return {
            "status": "success",
            "history_id": history_id,
            "transcription_index": transcription_index,
            "message": "Analysis added successfully"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding analysis to transcription: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to add analysis to transcription")

@app.get("/history/{history_id}/transcriptions")
async def get_transcriptions_from_history(history_id: str):
    """Get all transcriptions from a specific history record."""
    logger = logging.getLogger("get_transcriptions_from_history")
    logger.setLevel(logging.INFO)
    
    try:
        history_record = get_history_by_id(history_id)
        if not history_record:
            raise HTTPException(status_code=404, detail="History record not found")
        
        logger.info(f"Retrieved {len(history_record.transcriptions)} transcriptions from history {history_id}")
        return {
            "status": "success",
            "history_id": history_id,
            "count": len(history_record.transcriptions),
            "transcriptions": history_record.transcriptions
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving transcriptions from history: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retrieve transcriptions from history")

# WebSocket endpoint for real-time transcription
@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """WebSocket endpoint for real-time audio transcription."""
    logger = logging.getLogger("websocket_transcribe")
    logger.setLevel(logging.INFO)
    
    await websocket.accept()
    logger.info("WebSocket connection established")
    
    # Generate unique session ID
    session_id = str(uuid.uuid4())
    
    # Initialize transcription handler
    transcription_handler = None
    
    try:
        # Send initial connection acknowledgment
        await websocket.send_json({
            "type": "connection",
            "session_id": session_id,
            "status": "connected"
        })
        
        # Initialize transcription handler
        # TODO: Switch to LiveTranscriptionHandler when audio conversion is ready
        # from utils.transcription_live import LiveTranscriptionHandler
        # transcription_handler = LiveTranscriptionHandler(session_id)
        
        # For now, use simple mock handler for testing
        from utils.transcription_simple import SimpleTranscriptionHandler
        transcription_handler = SimpleTranscriptionHandler(session_id)
        
        # Start transcription session
        await transcription_handler.start_session()
        
        # Handle incoming messages
        while True:
            # WebSocket can receive either binary (audio) or text (control messages)
            message = await websocket.receive()
            
            if "bytes" in message:
                # Process audio chunk
                await transcription_handler.process_audio_chunk(message["bytes"])
            
            elif "text" in message:
                # Handle control messages (future use)
                control_msg = json.loads(message["text"])
                logger.info(f"Received control message: {control_msg}")
                
                if control_msg.get("type") == "stop":
                    break
            
            # Check for transcription results
            results = await transcription_handler.get_results()
            if results:
                await websocket.send_json({
                    "type": "transcription",
                    "results": results
                })
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for session {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
        await websocket.send_json({
            "type": "error",
            "message": str(e)
        })
    finally:
        # Clean up transcription session
        if transcription_handler:
            await transcription_handler.stop_session()
        try:
            await websocket.close()
        except:
            pass
        logger.info(f"WebSocket session {session_id} closed")

# Stateless live transcription endpoints
@app.get("/live/token")
async def get_speech_token():
    """
    Generate temporary Azure Speech Service token for frontend SDK.
    Modern approach: Frontend uses Azure Speech SDK directly with temp token.
    """
    logger = logging.getLogger("get_speech_token")
    
    try:
        # Import Azure Speech SDK
        import azure.cognitiveservices.speech as speechsdk
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider
        
        # Check if we have valid Azure credentials
        speech_key = os.getenv("AZURE_SPEECH_KEY")
        speech_endpoint = os.getenv("AZURE_SPEECH_ENDPOINT")
        speech_region = os.getenv("AZURE_SPEECH_REGION", "westeurope")
        
        logger.info(f"Azure Speech config - Key exists: {bool(speech_key)}, Endpoint: {speech_endpoint}, Region: {speech_region}")
        
        if not speech_key and not os.getenv("AZURE_CLIENT_ID"):
            logger.warning("No Azure Speech credentials available")
            return {
                "success": False,
                "error": "No Azure credentials configured",
                "mock_mode": True,
                "debug": {
                    "has_key": bool(speech_key),
                    "has_endpoint": bool(speech_endpoint),
                    "has_client_id": bool(os.getenv("AZURE_CLIENT_ID"))
                }
            }
        
        # Use region from environment or extract from endpoint
        region = speech_region
        if not region and speech_endpoint:
            try:
                # Extract region from endpoint URL (e.g., "westeurope" from "https://westeurope.api.cognitive.microsoft.com/")
                region = speech_endpoint.split('//')[1].split('.')[0]
            except:
                region = "westeurope"  # fallback
        
        # Generate authorization token
        if speech_key:
            # Azure Speech SDK doesn't provide direct token generation
            # Frontend will use the key directly or we can use REST API
            # For now, return the configuration for the frontend to handle
            logger.info("Using subscription key authentication")
            return {
                "success": True,
                "key": speech_key,  # Frontend will use this with SpeechConfig.fromSubscription
                "region": region,
                "endpoint": speech_endpoint,
                "service": "Azure Speech Service",
                "auth_method": "subscription_key"
            }
        else:
            # Use Azure Identity for token
            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, 
                "https://cognitiveservices.azure.com/.default"
            )
            auth_token = token_provider()
            return {
                "success": True,
                "token": auth_token,
                "region": region,
                "endpoint": speech_endpoint,
                "service": "Azure Speech Service",
                "auth_method": "managed_identity"
            }
        
    except Exception as e:
        logger.error(f"Failed to generate speech token: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "mock_mode": True
        }

@app.post("/live/save")
async def save_live_session(
    user_id: str = Form(...),
    session_id: str = Form(...),
    transcription_data: str = Form(...)
):
    """
    Save live transcription session to history.
    Compatible with existing batch processing workflow.
    """
    logger = logging.getLogger("save_live_session")
    
    try:
        import json
        
        # Parse transcription data from frontend
        transcription_results = json.loads(transcription_data)
        logger.info(f"Saving live session for user {user_id}, session {session_id}")
        logger.info(f"Transcription data contains {len(transcription_results)} results")
        
        # Create history record
        history_record = add_history_record(user_id, session_id, "live_transcription")
        logger.info(f"Created history record: {history_record.id}")
        
        # Convert live results to Transcript_chunk format
        transcript_chunks = []
        for result in transcription_results:
            chunk = Transcript_chunk(
                event_type="transcribed",
                session=session_id,
                offset=int(result.get('offset', 0) * 10000000),  # Convert seconds to 100ns units
                duration=int(result.get('duration', 2.0) * 10000000),  # Convert seconds to 100ns units
                text=result.get('text', ''),
                speaker_id=result.get('speaker', 'Unknown'),
                filename="Live Session",
                language="cs-CZ"  # Default language
            )
            transcript_chunks.append(chunk)
        
        # Create transcription record
        transcription_record = Transcription(
            file_name="Live Session",
            file_name_original="live://session",
            transcript_chunks=transcript_chunks,
            language="cs-CZ",
            model="azure_speech_sdk",
            temperature=0.0,
            diarization="true",
            combine="false",
            status="completed"
        )
        
        # Add transcription to history
        success = add_transcription_to_history(history_record.id, transcription_record)
        
        if success:
            logger.info(f"Successfully saved live session to history: {history_record.id}")
            return {
                "success": True,
                "history_id": history_record.id,
                "message": "Live session saved to history"
            }
        else:
            logger.error("Failed to add transcription to history")
            raise HTTPException(status_code=500, detail="Failed to save transcription to history")
            
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in transcription_data: {str(e)}")
        raise HTTPException(status_code=400, detail="Invalid transcription data format")
    except Exception as e:
        logger.error(f"Error saving live session: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save live session")

async def _generate_mock_transcription(audio_data: bytes, chunk_size: int):
    """Fallback mock transcription when Azure Speech Service is unavailable."""
    logger = logging.getLogger("mock_transcription")
    
    # Simple hash-based deterministic speaker assignment
    speaker_hash = hash(audio_data[:100]) % 3 + 1  # 3 possible speakers
    
    # Generate mock transcription
    current_time = time.time()
    results = []
    
    # Generate 1-2 transcription segments per chunk
    num_segments = 1 if chunk_size < 50000 else 2
    
    for i in range(num_segments):
        result = {
            "speaker": f"Mluvčí {speaker_hash}",
            "text": f"[MOCK] Simulovaný přepis audio segmentu {i+1}. Velikost: {chunk_size} bytes.",
            "offset": i * 2.0,  # 2 second segments
            "duration": 2.0,
            "timestamp": current_time + (i * 2.0),
            "confidence": 0.85 + (chunk_size % 100) / 1000  # Mock confidence
        }
        results.append(result)
    
    logger.info(f"Generated mock transcription: {len(results)} segments")
    
    return {
        "results": results,
        "chunk_info": {
            "size_bytes": chunk_size,
            "processed_at": current_time,
            "segments_generated": len(results),
            "service": "Mock Service (Fallback)"
        }
    }

# Legacy endpoints - kept for backward compatibility, will be removed in future versions
@app.post("/live/start")
async def start_live_session_legacy():
    """DEPRECATED: Use /live/transcribe for stateless approach."""
    return {
        "message": "This endpoint is deprecated. Use POST /live/transcribe for stateless live transcription.",
        "session_id": str(uuid.uuid4()),
        "status": "deprecated"
    }

@app.get("/live/status")
async def get_live_status():
    """Get status of live transcription service."""
    # Check Azure Speech Service availability
    azure_available = bool(os.getenv("AZURE_SPEECH_KEY") or os.getenv("AZURE_CLIENT_ID"))
    ffmpeg_available = await _check_ffmpeg_availability()
    
    return {
        "service": "Live Transcription",
        "mode": "Stateless",
        "version": "v2.1",
        "azure_speech_available": azure_available,
        "ffmpeg_available": ffmpeg_available,
        "endpoints": {
            "transcribe": "POST /live/transcribe - Upload audio chunk and get immediate results",
            "status": "GET /live/status - This endpoint",
            "test": "GET /live/test - Test endpoint"
        },
        "supported_formats": ["audio/webm", "audio/wav", "audio/ogg"],
        "fallback": "Mock transcription when Azure unavailable",
        "replica_friendly": True,
        "timestamp": time.time()
    }

async def _check_ffmpeg_availability():
    """Check if FFmpeg is available for audio conversion."""
    try:
        import subprocess
        process = await asyncio.create_subprocess_exec(
            'ffmpeg', '-version',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await process.communicate()
        return process.returncode == 0
    except:
        return False

@app.post("/live/test")
async def test_live_transcription(use_azure: bool = True):
    """Test live transcription with dummy audio data."""
    logger = logging.getLogger("test_live_transcription")
    
    try:
        # Create dummy WebM audio data for testing
        dummy_audio = b"dummy audio data for testing Azure Speech Service" * 500
        
        if use_azure:
            from utils.transcription_live_direct import process_audio_chunk_direct
            result = await process_audio_chunk_direct(dummy_audio)
            
            return {
                "test_type": "Azure Speech Service",
                "success": result.get("success", False),
                "results_count": len(result.get("results", [])),
                "error": result.get("error"),
                "processing_info": result.get("processing_info", {}),
                "timestamp": time.time()
            }
        else:
            # Test mock transcription
            mock_result = await _generate_mock_transcription(dummy_audio, len(dummy_audio))
            
            return {
                "test_type": "Mock Transcription",
                "success": True,
                "results_count": len(mock_result.get("results", [])),
                "chunk_info": mock_result.get("chunk_info", {}),
                "timestamp": time.time()
            }
            
    except Exception as e:
        logger.error(f"Test failed: {str(e)}")
        return {
            "test_type": "Azure Speech Service" if use_azure else "Mock",
            "success": False,
            "error": str(e),
            "timestamp": time.time()
        }

@app.get("/live/status") 
async def get_live_status():
    """Get status of live transcription service."""
    # Check Azure Speech Service availability
    azure_available = bool(os.getenv("AZURE_SPEECH_KEY") or os.getenv("AZURE_CLIENT_ID"))
    
    return {
        "service": "Live Transcription",
        "mode": "Azure Speech SDK (Frontend)",
        "version": "v3.0",
        "azure_speech_available": azure_available,
        "approach": "Direct frontend SDK with temp tokens",
        "endpoints": {
            "token": "GET /live/token - Get temporary Azure Speech token",
            "status": "GET /live/status - This endpoint"
        },
        "supported_features": [
            "Real-time WebSocket streaming",
            "Speaker diarization", 
            "Continuous recognition",
            "Browser microphone access"
        ],
        "no_backend_sessions": True,
        "replica_friendly": True,
        "timestamp": time.time()
    }

@app.get("/live/test")
async def test_live_endpoint():
    """Test endpoint to verify deployment."""
    return {
        "message": "Live endpoints are working",
        "version": "v2.0",
        "has_sessions_attr": hasattr(app.state, 'live_sessions'),
        "timestamp": time.time()
    }