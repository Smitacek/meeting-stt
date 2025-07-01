import operator
from dataclasses import field, dataclass
from typing_extensions import Annotated
from typing import List, Optional
from datetime import datetime

# Define the states 
@dataclass(kw_only=True)
class SummaryState:
    research_topic: str = field(default=None) # Report topic     
    search_query: str = field(default=None) # Search query
    rationale: str = field(default=None) # rationale for the search query
    web_research_results: Annotated[list, operator.add] = field(default_factory=list) 
    sources_gathered: Annotated[list, operator.add] = field(default_factory=list) 
    research_loop_count: int = field(default=0) # Research loop count
    running_summary: str = field(default=None) # Final report
    knowledge_gap: str = field(default=None) # Knowledge gap
    websocket_id: str = field(default=None) # Websocket ID
    thoughts: str = field(default=None) # model thoughts

@dataclass(kw_only=True)
class SummaryStateInput:
    research_topic: str = field(default=None) # Report topic  
    websocket_id: str = field(default=None) # Websocket ID   

@dataclass(kw_only=True)
class SummaryStateOutput:
    running_summary: str = field(default=None) # Final report

@dataclass(kw_only=True)
class Transcript_chunk:
    event_type: str = field(default="transcribed")  # Type of event
    session: Optional[str] = field(default=None)  # Session identifier
    offset: int = field(default=None)  # Offset in milliseconds
    duration: Optional[int] = field(default=None)  # Duration in milliseconds
    text: str = field(default=None)  # Transcribed text chunk
    speaker_id: Optional[str] = field(default=None)  # Speaker identifier
    result_id: Optional[str] = field(default=None)  # Result identifier
    filename: str = field(default=None)  # Source filename
    language: str = field(default=None)  # Language of the text

@dataclass(kw_only=True)
class Transcription:
    id: Optional[str] = field(default=None)  # Add unique ID for Azure Tables
    file_name: str = field(default=None)  # Name of the transcribed file
    file_name_original: str = field(default=None)  # Original filename before processing
    transcript_chunks: List[Transcript_chunk] = field(default_factory=list)  # List of transcript chunks
    language: str = field(default=None)  # Language used for transcription
    model: str = field(default=None)  # Model used (msft, llm, whisper)
    temperature: float = field(default=None)  # Temperature setting used
    diarization: str = field(default=None)  # Diarization setting
    combine: str = field(default=None)  # Combine setting
    analysis: str = field(default=None)  # Analysis results if performed
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())  # When transcription was created
    status: str = field(default="pending")  # Status: pending, completed, failed

@dataclass(kw_only=True)
class History:
    id: str = field(default=None)  # ID of history record
    user_id: str = field(default=None)  # ID of user making transcription
    session_id: str = field(default=None)  # ID of session of user
    transcriptions: List[Transcription] = field(default_factory=list)  # List of transcription objects
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())  # ANSI date string
    visible: bool = field(default=True)  # Visibility flag (default true)
    type: str = field(default="transcription")  # Type of history record