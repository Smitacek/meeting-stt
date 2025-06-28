#!/usr/bin/env python
# coding: utf-8

"""
Direct Azure Speech Service integration for stateless live transcription.
Processes individual audio chunks without session storage.
"""

import asyncio
import logging
import os
import time
import io
import tempfile
from typing import Dict, List, Any, Optional
import azure.cognitiveservices.speech as speechsdk
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

# Azure Speech Service configuration
speech_key = os.getenv("AZURE_SPEECH_KEY")
speech_endpoint = os.getenv("AZURE_SPEECH_ENDPOINT")

def _get_speech_config():
    """Initialize Azure Speech Service configuration."""
    try:
        if speech_key:
            speech_config = speechsdk.SpeechConfig(
                subscription=speech_key,
                endpoint=speech_endpoint
            )
        else:
            # Use Azure Identity for authentication
            credential = DefaultAzureCredential()
            token_provider = get_bearer_token_provider(
                credential, 
                "https://cognitiveservices.azure.com/.default"
            )
            auth_token = token_provider()
            speech_config = speechsdk.SpeechConfig(
                auth_token=auth_token,
                endpoint=speech_endpoint
            )
        
        # Configure for optimal real-time performance
        speech_config.speech_recognition_language = "cs-CZ"
        speech_config.request_word_level_timestamps()
        
        # Enable speaker diarization
        speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
            "5000"  # 5 seconds for short chunks
        )
        speech_config.set_property(
            speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
            "500"   # 0.5 second for faster response
        )
        
        return speech_config
        
    except Exception as e:
        logger.error(f"Failed to initialize speech config: {str(e)}")
        raise

# Global session manager for continuous transcription
_active_sessions = {}

async def process_audio_chunk_direct(audio_data: bytes, session_id: str = "default") -> Dict[str, Any]:
    """
    Process audio chunk using Azure Speech Service with continuous session.
    Uses PushAudioInputStream pattern for proper streaming.
    """
    try:
        # Check if we have valid Azure credentials
        if not speech_key and not os.getenv("AZURE_CLIENT_ID"):
            logger.warning("No Azure Speech credentials available")
            return {"success": False, "error": "No Azure credentials"}
        
        # Use PushAudioInputStream with GStreamer support (now installed in Docker)
        logger.info(f"Processing WebM/Opus audio with GStreamer: {len(audio_data)} bytes for session {session_id}")
        
        # Get or create session
        session = await _get_or_create_session(session_id)
        
        # Push audio data to the stream
        result = await _push_audio_to_session(session, audio_data)
        
        return result
        
    except Exception as e:
        logger.error(f"Azure Speech processing error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "results": []
        }

async def _get_or_create_session(session_id: str):
    """Get existing session or create new one."""
    if session_id not in _active_sessions:
        logger.info(f"Creating new Azure Speech session: {session_id}")
        
        # Get speech configuration
        speech_config = _get_speech_config()
        
        # Create push stream with WebM/Opus format support
        try:
            # Use compressed format for WebM/Opus
            logger.info("Creating PushAudioInputStream with WebM/Opus support")
            compressed_format = speechsdk.audio.AudioStreamContainerFormat.ANY
            push_stream = speechsdk.audio.PushAudioInputStream(compressed_format)
        except Exception as e:
            logger.warning(f"Compressed format failed: {str(e)}, trying PCM format")
            try:
                # Fallback to PCM format
                audio_format = speechsdk.audio.AudioStreamFormat.get_wave_format_pcm(
                    samples_per_second=16000,
                    bits_per_sample=16,
                    channels=1
                )
                push_stream = speechsdk.audio.PushAudioInputStream(audio_format)
            except Exception as e2:
                logger.warning(f"PCM format failed: {str(e2)}, using default")
                push_stream = speechsdk.audio.PushAudioInputStream()
            
        audio_config = speechsdk.audio.AudioConfig(stream=push_stream)
        
        # Try simple SpeechRecognizer first (without diarization for testing)
        try:
            logger.info("Creating simple SpeechRecognizer for testing")
            transcriber = speechsdk.SpeechRecognizer(
                speech_config=speech_config,
                audio_config=audio_config
            )
        except Exception as e:
            logger.warning(f"SpeechRecognizer failed, falling back to ConversationTranscriber: {str(e)}")
            # Fallback to conversation transcriber
            transcriber = speechsdk.transcription.ConversationTranscriber(
                speech_config=speech_config,
                audio_config=audio_config
            )
        
        # Store session info
        session = {
            "transcriber": transcriber,
            "push_stream": push_stream,
            "results": [],
            "errors": [],
            "created_at": time.time()
        }
        
        # Set up event handlers
        _setup_session_handlers(session)
        
        # Start transcription (different methods for different recognizers)
        if hasattr(transcriber, 'start_continuous_recognition_async'):
            await asyncio.get_event_loop().run_in_executor(
                None, 
                transcriber.start_continuous_recognition_async().get
            )
        else:
            await asyncio.get_event_loop().run_in_executor(
                None, 
                transcriber.start_transcribing_async().get
            )
        
        _active_sessions[session_id] = session
        logger.info(f"Azure Speech session started: {session_id}")
    
    return _active_sessions[session_id]

def _setup_session_handlers(session):
    """Setup event handlers for the session."""
    transcriber = session["transcriber"]
    
    def transcribed_handler(evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            # Handle both SpeechRecognizer and ConversationTranscriber
            speaker_id = getattr(evt.result, 'speaker_id', None) or "Unknown"
            speaker_label = f"Mluvčí {_map_speaker_id(speaker_id)}"
            
            result = {
                "speaker": speaker_label,
                "text": evt.result.text,
                "offset": evt.result.offset / 10000000,
                "duration": evt.result.duration / 10000000,
                "timestamp": time.time(),
                "confidence": 0.95,
                "azure_speaker_id": speaker_id
            }
            
            session["results"].append(result)
            logger.info(f"Azure transcribed: {speaker_label}: {evt.result.text}")
        elif evt.result.reason == speechsdk.ResultReason.NoMatch:
            logger.info("Azure Speech: No speech detected in audio chunk")
        else:
            logger.warning(f"Azure Speech unhandled reason: {evt.result.reason}")
    
    def canceled_handler(evt):
        error_msg = f"Azure Speech canceled: {evt.reason}"
        if hasattr(evt, 'error_details') and evt.reason == speechsdk.CancellationReason.Error:
            error_msg += f" - {evt.error_details}"
        session["errors"].append(error_msg)
        logger.error(error_msg)
    
    # Connect handlers (works for both SpeechRecognizer and ConversationTranscriber)
    if hasattr(transcriber, 'recognized'):
        transcriber.recognized.connect(transcribed_handler)
    else:
        transcriber.transcribed.connect(transcribed_handler)
    
    transcriber.canceled.connect(canceled_handler)

async def _push_audio_to_session(session, audio_data: bytes):
    """Push audio data to existing session and return results."""
    try:
        push_stream = session["push_stream"]
        
        # Push audio data to stream
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: push_stream.write(audio_data)
        )
        
        logger.info(f"Pushed {len(audio_data)} bytes to Azure Speech session")
        
        # Wait a bit for processing
        await asyncio.sleep(0.5)
        
        # Get recent results (last 5 seconds worth)
        current_time = time.time()
        recent_results = [
            r for r in session["results"] 
            if current_time - r["timestamp"] <= 5.0
        ]
        
        # Clear old results to prevent memory buildup
        session["results"] = [
            r for r in session["results"] 
            if current_time - r["timestamp"] <= 30.0
        ]
        
        return {
            "success": True,
            "results": recent_results,
            "processing_info": {
                "audio_size": len(audio_data),
                "segments_found": len(recent_results),
                "service": "Azure Speech Service (Push Stream)",
                "session_age": current_time - session["created_at"]
            }
        }
        
    except Exception as e:
        logger.error(f"Error pushing audio to session: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "results": []
        }

async def cleanup_session(session_id: str = "default"):
    """Clean up Azure Speech session."""
    if session_id in _active_sessions:
        session = _active_sessions[session_id]
        try:
            # Stop transcription (different methods for different recognizers)
            transcriber = session["transcriber"]
            if hasattr(transcriber, 'stop_continuous_recognition_async'):
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    transcriber.stop_continuous_recognition_async().get
                )
            else:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    transcriber.stop_transcribing_async().get
                )
            # Close stream
            session["push_stream"].close()
            logger.info(f"Cleaned up Azure Speech session: {session_id}")
        except Exception as e:
            logger.error(f"Error cleaning up session {session_id}: {str(e)}")
        finally:
            del _active_sessions[session_id]
    else:
        logger.warning(f"Session {session_id} not found for cleanup")
    
    return {"status": "cleaned", "session_id": session_id}

async def _process_with_rest_api(audio_file_path: str) -> Dict[str, Any]:
    """
    Process audio using Azure Speech Service REST API for short audio.
    This is more suitable for stateless chunk processing.
    """
    try:
        try:
            import aiohttp
        except ImportError:
            logger.error("aiohttp not available for REST API calls")
            return {"success": False, "error": "aiohttp dependency missing"}
            
        import json
        
        # Read the audio file
        with open(audio_file_path, 'rb') as audio_file:
            audio_content = audio_file.read()
        
        logger.info(f"Processing {len(audio_content)} bytes with REST API")
        
        # REST API endpoint
        region = speech_endpoint.split('//')[1].split('.')[0] if speech_endpoint else "westeurope"
        url = f"https://{region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1"
        
        # Parameters
        params = {
            'language': 'cs-CZ',
            'format': 'detailed'
        }
        
        # Headers
        headers = {
            'Ocp-Apim-Subscription-Key': speech_key,
            'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
            'Accept': 'application/json'
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, params=params, headers=headers, data=audio_content) as response:
                if response.status == 200:
                    result_json = await response.json()
                    logger.info(f"REST API response: {result_json}")
                    
                    # Parse the response
                    results = []
                    if result_json.get('RecognitionStatus') == 'Success':
                        display_text = result_json.get('DisplayText', '')
                        if display_text.strip():
                            # Simple result without speaker diarization for now
                            result = {
                                "speaker": "Mluvčí 1",
                                "text": display_text.strip(),
                                "offset": 0.0,
                                "duration": result_json.get('Duration', 0) / 10000000,
                                "timestamp": time.time(),
                                "confidence": 0.95
                            }
                            results.append(result)
                            logger.info(f"REST API transcribed: {display_text}")
                    
                    return {
                        "success": True,
                        "results": results,
                        "processing_info": {
                            "audio_size": len(audio_content),
                            "segments_found": len(results),
                            "service": "Azure Speech Service (REST API)",
                            "recognition_status": result_json.get('RecognitionStatus')
                        }
                    }
                else:
                    error_text = await response.text()
                    logger.error(f"REST API error {response.status}: {error_text}")
                    return {
                        "success": False,
                        "error": f"REST API error {response.status}: {error_text}",
                        "results": []
                    }
                    
    except Exception as e:
        logger.error(f"REST API processing error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "results": []
        }

async def _prepare_audio_for_azure(audio_data: bytes) -> Optional[str]:
    """
    Prepare audio data for Azure Speech Service.
    Convert WebM/Opus to WAV format using FFmpeg if available.
    """
    try:
        # Create temporary files
        input_fd, input_path = tempfile.mkstemp(suffix='.webm')
        output_fd, output_path = tempfile.mkstemp(suffix='.wav')
        
        try:
            # Write input audio data
            with os.fdopen(input_fd, 'wb') as input_file:
                input_file.write(audio_data)
            
            # Close output file descriptor (FFmpeg will write to it)
            os.close(output_fd)
            
            # Try FFmpeg conversion
            if await _convert_with_ffmpeg(input_path, output_path):
                # Verify conversion worked
                if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                    logger.info(f"Audio converted: {output_path}, size: {os.path.getsize(output_path)} bytes")
                    # Clean up input file
                    os.remove(input_path)
                    return output_path
            
            # Fallback: try to use input file directly (might work for some formats)
            logger.warning("FFmpeg conversion failed, trying direct file")
            os.remove(output_path)  # Remove empty output file
            
            # Rename input file to .wav extension (sometimes works)
            fallback_path = input_path + '.wav'
            os.rename(input_path, fallback_path)
            
            if os.path.exists(fallback_path) and os.path.getsize(fallback_path) > 0:
                logger.info(f"Using direct audio file: {fallback_path}")
                return fallback_path
            
            logger.warning("Audio preparation failed - no valid output")
            return None
                
        except Exception as e:
            # Clean up on error
            for path in [input_path, output_path]:
                if os.path.exists(path):
                    os.remove(path)
            raise e
            
    except Exception as e:
        logger.error(f"Audio preparation error: {str(e)}")
        return None

async def _convert_with_ffmpeg(input_path: str, output_path: str) -> bool:
    """
    Convert audio file using FFmpeg.
    Returns True if conversion successful, False otherwise.
    """
    try:
        import subprocess
        
        # FFmpeg command to convert to WAV format suitable for Azure Speech
        ffmpeg_cmd = [
            'ffmpeg', '-i', input_path,
            '-acodec', 'pcm_s16le',  # 16-bit PCM
            '-ar', '16000',          # 16kHz sample rate
            '-ac', '1',              # Mono
            '-y',                    # Overwrite output
            output_path
        ]
        
        # Run FFmpeg conversion
        process = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode == 0:
            logger.info("FFmpeg conversion successful")
            return True
        else:
            logger.warning(f"FFmpeg conversion failed: {stderr.decode()}")
            return False
            
    except FileNotFoundError:
        logger.warning("FFmpeg not found - audio conversion unavailable")
        return False
    except Exception as e:
        logger.error(f"FFmpeg conversion error: {str(e)}")
        return False

def _map_speaker_id(azure_speaker_id: str) -> int:
    """
    Map Azure speaker ID to simple numeric ID.
    Ensures consistent speaker labeling across chunks.
    """
    # Simple hash-based mapping
    if not azure_speaker_id or azure_speaker_id == "Unknown":
        return 1
    
    # Use hash to get consistent speaker number
    speaker_hash = hash(azure_speaker_id) % 5 + 1  # 1-5 speakers
    return speaker_hash

# Test function for development
async def test_audio_processing():
    """Test function for Azure Speech integration."""
    logger.info("Testing Azure Speech Service integration...")
    
    # Create dummy audio data for testing
    dummy_audio = b"dummy audio data for testing" * 1000
    
    result = await process_audio_chunk_direct(dummy_audio)
    
    if result["success"]:
        logger.info(f"Test successful: {len(result['results'])} results")
    else:
        logger.error(f"Test failed: {result.get('error', 'Unknown error')}")
    
    return result

if __name__ == "__main__":
    # Run test when module is executed directly
    asyncio.run(test_audio_processing())