#!/usr/bin/env python
# coding: utf-8

"""
Live transcription handler for real-time audio streaming using Azure Speech SDK
"""

import asyncio
import logging
import os
import time
import uuid
from typing import List, Dict, Optional, Any
from collections import deque
import azure.cognitiveservices.speech as speechsdk
from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from dotenv import load_dotenv
import io
import subprocess
import tempfile

load_dotenv(override=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Azure Speech Service configuration
speech_key = os.getenv("AZURE_SPEECH_KEY")
speech_endpoint = os.getenv("AZURE_SPEECH_ENDPOINT")

class LiveTranscriptionHandler:
    """Handles real-time audio transcription using Azure Speech Services."""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.logger = logging.getLogger(f"LiveTranscription_{session_id}")
        
        # Azure Speech SDK components
        self.push_stream = None
        self.speech_config = None
        self.conversation_transcriber = None
        
        # Results queue
        self.results_queue = deque()
        
        # Session state
        self.is_active = False
        self.start_time = None
        
        # Speaker tracking
        self.speaker_map = {}  # Maps Azure speaker IDs to simplified labels
        self.next_speaker_id = 1
        
        # Audio buffer for WebM chunks
        self.audio_buffer = io.BytesIO()
        self.conversion_process = None
        
        # Initialize Azure Speech configuration
        self._initialize_speech_config()
        
    def _initialize_speech_config(self):
        """Initialize Azure Speech Service configuration."""
        try:
            if speech_key:
                self.speech_config = speechsdk.SpeechConfig(
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
                self.speech_config = speechsdk.SpeechConfig(
                    auth_token=auth_token,
                    endpoint=speech_endpoint
                )
            
            # Configure for optimal real-time performance
            self.speech_config.speech_recognition_language = "cs-CZ"
            self.speech_config.request_word_level_timestamps()
            self.speech_config.set_property(
                speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
                "30000"  # 30 seconds initial silence timeout
            )
            self.speech_config.set_property(
                speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
                "1000"  # 1 second end silence timeout for faster response
            )
            
            self.logger.info("Speech configuration initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize speech config: {str(e)}")
            raise
    
    async def start_session(self):
        """Start the live transcription session."""
        try:
            # Create push audio stream with PCM 16kHz format
            # Azure Speech expects 16kHz, 16-bit, mono PCM
            stream_format = speechsdk.audio.AudioStreamFormat.get_wave_format_pcm(
                samples_per_second=16000,
                bits_per_sample=16,
                channels=1
            )
            self.push_stream = speechsdk.audio.PushAudioInputStream(stream_format)
            
            # Create audio configuration
            audio_config = speechsdk.audio.AudioConfig(stream=self.push_stream)
            
            # Create conversation transcriber for diarization
            self.conversation_transcriber = speechsdk.transcription.ConversationTranscriber(
                speech_config=self.speech_config,
                audio_config=audio_config
            )
            
            # Set up event handlers
            self._setup_event_handlers()
            
            # Start continuous transcription
            await asyncio.get_event_loop().run_in_executor(
                None, 
                self.conversation_transcriber.start_transcribing_async().get
            )
            
            self.is_active = True
            self.start_time = time.time()
            self.logger.info(f"Live transcription session {self.session_id} started")
            
        except Exception as e:
            self.logger.error(f"Failed to start transcription session: {str(e)}")
            raise
    
    def _setup_event_handlers(self):
        """Set up event handlers for transcription events."""
        
        def transcribed_handler(evt: speechsdk.transcription.ConversationTranscriptionEventArgs):
            """Handle transcribed speech events."""
            if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
                # Map Azure speaker ID to simple label
                azure_speaker_id = evt.result.speaker_id
                if azure_speaker_id not in self.speaker_map:
                    self.speaker_map[azure_speaker_id] = f"Mluvčí {self.next_speaker_id}"
                    self.next_speaker_id += 1
                
                speaker_label = self.speaker_map[azure_speaker_id]
                
                # Create result object
                result = {
                    "speaker": speaker_label,
                    "text": evt.result.text,
                    "offset": evt.result.offset / 10000000,  # Convert to seconds
                    "duration": evt.result.duration / 10000000,  # Convert to seconds
                    "timestamp": time.time() - self.start_time
                }
                
                # Add to results queue
                self.results_queue.append(result)
                self.logger.info(f"Transcribed: {speaker_label}: {evt.result.text}")
        
        def session_started_handler(evt):
            """Handle session started events."""
            self.logger.info(f"Session started: {evt.session_id}")
        
        def session_stopped_handler(evt):
            """Handle session stopped events."""
            self.logger.info(f"Session stopped: {evt.session_id}")
        
        def canceled_handler(evt: speechsdk.transcription.ConversationTranscriptionCanceledEventArgs):
            """Handle cancellation events."""
            self.logger.error(f"Recognition canceled: {evt.reason}")
            if evt.reason == speechsdk.CancellationReason.Error:
                self.logger.error(f"Error details: {evt.error_details}")
                # Add error to results queue
                self.results_queue.append({
                    "type": "error",
                    "message": evt.error_details,
                    "timestamp": time.time() - self.start_time
                })
        
        # Connect event handlers
        self.conversation_transcriber.transcribed.connect(transcribed_handler)
        self.conversation_transcriber.session_started.connect(session_started_handler)
        self.conversation_transcriber.session_stopped.connect(session_stopped_handler)
        self.conversation_transcriber.canceled.connect(canceled_handler)
    
    async def process_audio_chunk(self, audio_data: bytes):
        """Process incoming audio chunk."""
        if not self.is_active or not self.push_stream:
            self.logger.warning("Attempted to process audio while session inactive")
            return
        
        try:
            # Note: Browser sends WebM/Opus format which needs conversion
            # For MVP, we'll use raw PCM format from browser instead
            # TODO: Add FFmpeg conversion for WebM/Opus support
            
            # Write audio data to push stream
            self.push_stream.write(audio_data)
            
        except Exception as e:
            self.logger.error(f"Error processing audio chunk: {str(e)}")
            raise
    
    async def get_results(self) -> List[Dict[str, Any]]:
        """Get pending transcription results."""
        results = []
        
        # Get all available results from queue
        while self.results_queue:
            results.append(self.results_queue.popleft())
        
        return results
    
    async def stop_session(self):
        """Stop the live transcription session."""
        if not self.is_active:
            return
        
        try:
            self.is_active = False
            
            # Close push stream
            if self.push_stream:
                self.push_stream.close()
            
            # Stop transcription
            if self.conversation_transcriber:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    self.conversation_transcriber.stop_transcribing_async().get
                )
            
            self.logger.info(f"Live transcription session {self.session_id} stopped")
            
        except Exception as e:
            self.logger.error(f"Error stopping transcription session: {str(e)}")
    
    def get_session_info(self) -> Dict[str, Any]:
        """Get current session information."""
        return {
            "session_id": self.session_id,
            "is_active": self.is_active,
            "duration": time.time() - self.start_time if self.start_time else 0,
            "speaker_count": len(self.speaker_map),
            "speaker_mapping": self.speaker_map
        }