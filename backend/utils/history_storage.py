"""
Azure Storage Tables implementation for transcription history persistence.
Replaces in-memory storage to support multiple replicas and data persistence.
"""

import os
import json
import logging
from typing import List, Optional
from datetime import datetime
from azure.data.tables import TableServiceClient, TableEntity
from azure.identity import DefaultAzureCredential
from azure.core.exceptions import ResourceNotFoundError, ResourceExistsError

from utils.states import History, Transcription, Transcript_chunk


class HistoryStorage:
    """
    Persistent storage for transcription history using Azure Storage Tables.
    Provides CRUD operations for History and Transcription objects.
    """
    
    def __init__(self):
        """Initialize Azure Storage Tables client."""
        self.logger = logging.getLogger("HistoryStorage")
        
        # Get storage account credentials from environment
        storage_account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME")
        storage_account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY")
        
        # Only require name and key - we'll construct the table endpoint ourselves
        if not all([storage_account_name, storage_account_key]):
            self.logger.warning("Missing Azure Storage credentials (name/key), will use fallback in-memory storage")
            self.use_azure_tables = False
            self._init_in_memory_storage()
            return
        
        self.use_azure_tables = True
        self.logger.info(f"Initializing Azure Tables storage for account: {storage_account_name}")
        
        # Initialize Table Service Client
        try:
            # Try different authentication methods
            if storage_account_key:
                # Use account key authentication
                account_url = f"https://{storage_account_name}.table.core.windows.net/"
                self.table_service = TableServiceClient(
                    endpoint=account_url,
                    credential=storage_account_key
                )
                self.logger.info("Using storage account key authentication")
            else:
                # Fallback to DefaultAzureCredential
                account_url = f"https://{storage_account_name}.table.core.windows.net/"
                self.table_service = TableServiceClient(
                    endpoint=account_url,
                    credential=DefaultAzureCredential()
                )
                self.logger.info("Using DefaultAzureCredential authentication")
            
            # Table names
            self.history_table_name = "TranscriptionHistory"
            self.transcription_table_name = "Transcriptions"
            
            # Create tables if they don't exist
            self._ensure_tables_exist()
            
            self.logger.info("HistoryStorage initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize HistoryStorage: {str(e)}")
            self.logger.warning("Falling back to in-memory storage")
            self.use_azure_tables = False
            self._init_in_memory_storage()
    
    def _init_in_memory_storage(self):
        """Initialize in-memory storage as fallback."""
        self.memory_history = {}
        self.memory_transcriptions = {}
        self.logger.info("In-memory storage initialized")
    
    def _ensure_tables_exist(self):
        """Create tables if they don't exist."""
        try:
            # Create History table
            try:
                self.table_service.create_table(self.history_table_name)
                self.logger.info(f"Created table: {self.history_table_name}")
            except ResourceExistsError:
                self.logger.debug(f"Table already exists: {self.history_table_name}")
            
            # Create Transcription table  
            try:
                self.table_service.create_table(self.transcription_table_name)
                self.logger.info(f"Created table: {self.transcription_table_name}")
            except ResourceExistsError:
                self.logger.debug(f"Table already exists: {self.transcription_table_name}")
                
        except Exception as e:
            self.logger.error(f"Failed to create tables: {str(e)}")
            raise
    
    def add_history_record(self, user_id: str, session_id: str, history_type: str = "transcription") -> History:
        """Create and store a new history record."""
        import uuid
        
        history_id = str(uuid.uuid4())
        timestamp = datetime.now().isoformat()
        
        # Create History object
        history_record = History(
            id=history_id,
            user_id=user_id,
            session_id=session_id,
            type=history_type,
            timestamp=timestamp,
            visible=True,
            transcriptions=[]
        )
        
        if not self.use_azure_tables:
            # In-memory fallback
            self.memory_history[history_id] = history_record
            self.logger.info(f"Added history record {history_id} to memory storage")
            return history_record
        
        # Azure Tables implementation
        # Convert to table entity
        entity = {
            "PartitionKey": user_id,  # Partition by user for efficient queries
            "RowKey": history_id,
            "user_id": user_id,
            "session_id": session_id,
            "type": history_type,
            "timestamp": timestamp,
            "visible": True,
            "transcription_count": 0  # Track number of transcriptions
        }
        
        try:
            table_client = self.table_service.get_table_client(self.history_table_name)
            table_client.create_entity(entity)
            self.logger.info(f"Created history record: {history_id}")
            return history_record
            
        except Exception as e:
            self.logger.error(f"Failed to create history record: {str(e)}")
            raise
    
    def add_transcription_to_history(self, history_id: str, transcription: Transcription) -> bool:
        """Add a transcription to an existing history record."""
        try:
            # First, get the history record to find its partition key
            history_record = self.get_history_by_id(history_id)
            if not history_record:
                self.logger.error(f"History record not found: {history_id}")
                return False
            
            # Generate transcription ID
            import uuid
            transcription_id = str(uuid.uuid4())
            
            # Convert Transcription to storage format
            transcription_entity = {
                "PartitionKey": history_id,  # Partition by history_id
                "RowKey": transcription_id,
                "history_id": history_id,
                "file_name": transcription.file_name,
                "file_name_original": transcription.file_name_original,
                "language": transcription.language,
                "model": transcription.model,
                "temperature": transcription.temperature,
                "diarization": transcription.diarization,
                "combine": transcription.combine,
                "analysis": transcription.analysis,
                "timestamp": transcription.timestamp,
                "status": transcription.status,
                # Store transcript chunks as JSON
                "transcript_chunks": json.dumps([{
                    "event_type": chunk.event_type,
                    "session": chunk.session,
                    "offset": chunk.offset,
                    "duration": chunk.duration,
                    "text": chunk.text,
                    "speaker_id": chunk.speaker_id,
                    "result_id": chunk.result_id,
                    "filename": chunk.filename,
                    "language": chunk.language
                } for chunk in transcription.transcript_chunks])
            }
            
            # Store transcription
            transcription_table = self.table_service.get_table_client(self.transcription_table_name)
            transcription_table.create_entity(transcription_entity)
            
            # Update history record transcription count
            history_table = self.table_service.get_table_client(self.history_table_name)
            history_entity = history_table.get_entity(
                partition_key=history_record.user_id,
                row_key=history_id
            )
            history_entity["transcription_count"] = history_entity.get("transcription_count", 0) + 1
            history_table.update_entity(history_entity)
            
            self.logger.info(f"Added transcription {transcription_id} to history {history_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to add transcription to history: {str(e)}")
            return False
    
    def get_history_by_id(self, history_id: str) -> Optional[History]:
        """Get a history record by ID."""
        try:
            # Query across all partitions to find the history record
            history_table = self.table_service.get_table_client(self.history_table_name)
            filter_query = f"RowKey eq '{history_id}'"
            
            entities = list(history_table.query_entities(filter_query))
            if not entities:
                return None
            
            entity = entities[0]
            
            # Get associated transcriptions
            transcriptions = self._get_transcriptions_for_history(history_id)
            
            # Convert back to History object
            history_record = History(
                id=entity["RowKey"],
                user_id=entity["user_id"],
                session_id=entity["session_id"],
                type=entity["type"],
                timestamp=entity["timestamp"],
                visible=entity["visible"],
                transcriptions=transcriptions
            )
            
            return history_record
            
        except Exception as e:
            self.logger.error(f"Failed to get history record {history_id}: {str(e)}")
            return None
    
    def get_all_history(self, visible_only: bool = True, limit: int = 100) -> List[History]:
        """Get all history records with optional filtering."""
        try:
            if not self.use_azure_tables:
                # In-memory fallback
                histories = list(self.memory_history.values())
                if visible_only:
                    histories = [h for h in histories if h.visible]
                return histories[:limit]
            
            # Azure Tables implementation
            history_table = self.table_service.get_table_client(self.history_table_name)
            
            # Build filter query
            filter_parts = []
            if visible_only:
                filter_parts.append("visible eq true")
            
            filter_query = " and ".join(filter_parts) if filter_parts else None
            
            # Query entities with limit
            entities = list(history_table.query_entities(
                filter_query, 
                select=["PartitionKey", "RowKey", "user_id", "session_id", "type", "timestamp", "visible", "transcription_count"]
            ))
            
            # Sort by timestamp (newest first) and apply limit
            entities.sort(key=lambda x: x["timestamp"], reverse=True)
            entities = entities[:limit]
            
            # Convert to History objects (without loading full transcriptions for performance)
            histories = []
            for entity in entities:
                history_record = History(
                    id=entity["RowKey"],
                    user_id=entity["user_id"],
                    session_id=entity["session_id"],
                    type=entity["type"],
                    timestamp=entity["timestamp"],
                    visible=entity["visible"],
                    transcriptions=[]  # Load on demand
                )
                histories.append(history_record)
            
            self.logger.info(f"Retrieved {len(histories)} history records")
            return histories
            
        except Exception as e:
            self.logger.error(f"Failed to get all history: {str(e)}")
            return []
    
    def get_user_history(self, user_id: str, visible_only: bool = True) -> List[History]:
        """Get all history records for a specific user."""
        try:
            history_table = self.table_service.get_table_client(self.history_table_name)
            
            # Query by partition key (user_id)
            filter_parts = [f"PartitionKey eq '{user_id}'"]
            if visible_only:
                filter_parts.append("visible eq true")
            
            filter_query = " and ".join(filter_parts)
            
            entities = list(history_table.query_entities(filter_query))
            
            # Convert to History objects
            histories = []
            for entity in entities:
                # Get transcriptions for this history
                transcriptions = self._get_transcriptions_for_history(entity["RowKey"])
                
                history_record = History(
                    id=entity["RowKey"],
                    user_id=entity["user_id"],
                    session_id=entity["session_id"],
                    type=entity["type"],
                    timestamp=entity["timestamp"],
                    visible=entity["visible"],
                    transcriptions=transcriptions
                )
                histories.append(history_record)
            
            self.logger.info(f"Retrieved {len(histories)} history records for user {user_id}")
            return histories
            
        except Exception as e:
            self.logger.error(f"Failed to get user history for {user_id}: {str(e)}")
            return []
    
    def get_session_history(self, session_id: str, visible_only: bool = True) -> List[History]:
        """Get all history records for a specific session."""
        try:
            history_table = self.table_service.get_table_client(self.history_table_name)
            
            # Query by session_id
            filter_parts = [f"session_id eq '{session_id}'"]
            if visible_only:
                filter_parts.append("visible eq true")
            
            filter_query = " and ".join(filter_parts)
            
            entities = list(history_table.query_entities(filter_query))
            
            # Convert to History objects
            histories = []
            for entity in entities:
                # Get transcriptions for this history
                transcriptions = self._get_transcriptions_for_history(entity["RowKey"])
                
                history_record = History(
                    id=entity["RowKey"],
                    user_id=entity["user_id"],
                    session_id=entity["session_id"],
                    type=entity["type"],
                    timestamp=entity["timestamp"],
                    visible=entity["visible"],
                    transcriptions=transcriptions
                )
                histories.append(history_record)
            
            self.logger.info(f"Retrieved {len(histories)} history records for session {session_id}")
            return histories
            
        except Exception as e:
            self.logger.error(f"Failed to get session history for {session_id}: {str(e)}")
            return []
    
    def toggle_history_visibility(self, history_id: str, visible: bool) -> bool:
        """Toggle the visibility of a history record."""
        try:
            self.logger.info(f"Starting toggle_history_visibility for {history_id} to {visible}")
            
            if not self.use_azure_tables:
                # In-memory fallback
                if history_id in self.memory_history:
                    self.memory_history[history_id].visible = visible
                    self.logger.info(f"Updated in-memory history {history_id} visibility to {visible}")
                    return True
                else:
                    self.logger.warning(f"History record {history_id} not found in memory")
                    return False
            
            # Azure Tables implementation
            # First find the history record
            history_record = self.get_history_by_id(history_id)
            if not history_record:
                self.logger.warning(f"History record {history_id} not found")
                return False
            
            self.logger.info(f"Found history record: user_id={history_record.user_id}")
            
            # Update visibility
            history_table = self.table_service.get_table_client(self.history_table_name)
            entity = history_table.get_entity(
                partition_key=history_record.user_id,
                row_key=history_id
            )
            self.logger.info(f"Retrieved entity, current visible={entity.get('visible')}")
            
            entity["visible"] = visible
            history_table.update_entity(entity)
            
            self.logger.info(f"Updated history {history_id} visibility to {visible}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to update history visibility: {str(e)}", exc_info=True)
            return False
    
    def _get_transcriptions_for_history(self, history_id: str) -> List[Transcription]:
        """Get all transcriptions for a specific history record."""
        try:
            transcription_table = self.table_service.get_table_client(self.transcription_table_name)
            
            # Query by partition key (history_id)
            filter_query = f"PartitionKey eq '{history_id}'"
            entities = list(transcription_table.query_entities(filter_query))
            
            transcriptions = []
            for entity in entities:
                # Parse transcript chunks from JSON
                transcript_chunks = []
                if entity.get("transcript_chunks"):
                    chunks_data = json.loads(entity["transcript_chunks"])
                    for chunk_data in chunks_data:
                        chunk = Transcript_chunk(
                            event_type=chunk_data.get("event_type"),
                            session=chunk_data.get("session"),
                            offset=chunk_data.get("offset"),
                            duration=chunk_data.get("duration"),
                            text=chunk_data.get("text"),
                            speaker_id=chunk_data.get("speaker_id"),
                            result_id=chunk_data.get("result_id"),
                            filename=chunk_data.get("filename"),
                            language=chunk_data.get("language")
                        )
                        transcript_chunks.append(chunk)
                
                transcription = Transcription(
                    file_name=entity.get("file_name"),
                    file_name_original=entity.get("file_name_original"),
                    transcript_chunks=transcript_chunks,
                    language=entity.get("language"),
                    model=entity.get("model"),
                    temperature=entity.get("temperature"),
                    diarization=entity.get("diarization"),
                    combine=entity.get("combine"),
                    analysis=entity.get("analysis"),
                    timestamp=entity.get("timestamp"),
                    status=entity.get("status")
                )
                transcriptions.append(transcription)
            
            return transcriptions
            
        except Exception as e:
            self.logger.error(f"Failed to get transcriptions for history {history_id}: {str(e)}")
            return []


# Global instance for use in main.py
history_storage = None

def get_history_storage() -> HistoryStorage:
    """Get or create the global history storage instance."""
    global history_storage
    if history_storage is None:
        history_storage = HistoryStorage()
    return history_storage