#!/usr/bin/env python
# coding: utf-8

"""
Simple transcription handler for testing real-time audio without format conversion
"""

import asyncio
import logging
import time
from typing import List, Dict, Any
from collections import deque

logger = logging.getLogger(__name__)

class SimpleTranscriptionHandler:
    """Mock handler for testing WebSocket connection without actual transcription."""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.logger = logging.getLogger(f"SimpleTranscription_{session_id}")
        self.results_queue = deque()
        self.is_active = False
        self.start_time = None
        self.chunk_count = 0
        
    async def start_session(self):
        """Start the mock transcription session."""
        self.is_active = True
        self.start_time = time.time()
        self.logger.info(f"Simple transcription session {self.session_id} started")
        
        # Add initial message
        self.results_queue.append({
            "speaker": "System",
            "text": "Transcription session started. Waiting for audio...",
            "offset": 0,
            "duration": 0,
            "timestamp": 0
        })
    
    async def process_audio_chunk(self, audio_data: bytes):
        """Process incoming audio chunk - just count for now."""
        if not self.is_active:
            return
        
        self.chunk_count += 1
        
        # Every 10 chunks, generate a mock transcription
        if self.chunk_count % 10 == 0:
            elapsed = time.time() - self.start_time
            self.results_queue.append({
                "speaker": f"Mluvčí {(self.chunk_count // 10) % 2 + 1}",
                "text": f"Test transcription segment {self.chunk_count // 10}. Audio chunk size: {len(audio_data)} bytes.",
                "offset": elapsed,
                "duration": 1.0,
                "timestamp": elapsed
            })
            self.logger.info(f"Generated mock transcription for chunk {self.chunk_count}")
    
    async def get_results(self) -> List[Dict[str, Any]]:
        """Get pending transcription results."""
        results = []
        while self.results_queue:
            results.append(self.results_queue.popleft())
        return results
    
    async def stop_session(self):
        """Stop the mock transcription session."""
        self.is_active = False
        self.logger.info(f"Simple transcription session {self.session_id} stopped. Total chunks: {self.chunk_count}")
    
    def get_session_info(self) -> Dict[str, Any]:
        """Get current session information."""
        return {
            "session_id": self.session_id,
            "is_active": self.is_active,
            "duration": time.time() - self.start_time if self.start_time else 0,
            "chunk_count": self.chunk_count
        }