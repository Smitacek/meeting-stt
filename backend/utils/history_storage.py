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
from azure.core.credentials import AzureNamedKeyCredential

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
                # Use account key authentication with AzureNamedKeyCredential
                account_url = f"https://{storage_account_name}.table.core.windows.net/"
                credential = AzureNamedKeyCredential(storage_account_name, storage_account_key)
                self.table_service = TableServiceClient(
                    endpoint=account_url,
                    credential=credential
                )
                self.logger.info("Using AzureNamedKeyCredential authentication")
            else:
                # Fallback to DefaultAzureCredential
                account_url = f"https://{storage_account_name}.table.core.windows.net/"
                self.table_service = TableServiceClient(
                    endpoint=account_url,
                    credential=DefaultAzureCredential()
                )
                self.logger.info("Using DefaultAzureCredential authentication")
            
            # Single table for all history data
            self.table_name = "TranscriptionHistory"
            
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
        self.logger.warning("USING IN-MEMORY STORAGE - data will be lost on restart!")
        self.logger.info("In-memory storage initialized")
    
    def _ensure_tables_exist(self):
        """Create table if it doesn't exist."""
        try:
            try:
                self.table_service.create_table(self.table_name)
                self.logger.info(f"Created table: {self.table_name}")
            except ResourceExistsError:
                self.logger.debug(f"Table already exists: {self.table_name}")
                
        except Exception as e:
            self.logger.error(f"Failed to create table: {str(e)}")
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
        
        # Azure Tables implementation - single table design
        # PartitionKey = history_id, RowKey = "main" for metadata
        entity = {
            "PartitionKey": history_id,
            "RowKey": "main",  # Main record for history metadata
            "entity_type": "history",  # Distinguish from transcriptions
            "user_id": user_id,
            "session_id": session_id,
            "type": history_type,
            "timestamp": timestamp,
            "visible": True,
            "transcription_count": 0
        }
        
        try:
            table_client = self.table_service.get_table_client(self.table_name)
            table_client.create_entity(entity)
            self.logger.info(f"Created history record: {history_id}")
            return history_record
            
        except Exception as e:
            self.logger.error(f"Failed to create history record: {str(e)}")
            raise
    
    def add_transcription_to_history(self, history_id: str, transcription: Transcription) -> bool:
        """Add a transcription to an existing history record."""
        try:
            if not self.use_azure_tables:
                # In-memory storage
                if history_id in self.memory_history:
                    # Generate ID if missing
                    if not transcription.id:
                        import uuid
                        transcription.id = str(uuid.uuid4())
                    
                    self.memory_history[history_id].transcriptions.append(transcription)
                    
                    # Store transcription separately for consistency
                    if not hasattr(self, 'memory_transcriptions'):
                        self.memory_transcriptions = {}
                    self.memory_transcriptions[transcription.id] = transcription
                    
                    self.logger.info(f"Added transcription {transcription.id} to in-memory history {history_id}")
                    return True
                else:
                    self.logger.error(f"History record not found in memory: {history_id}")
                    return False
            
            # Azure Tables implementation
            # First, get the history record to find its partition key
            history_record = self.get_history_by_id(history_id)
            if not history_record:
                self.logger.error(f"History record not found: {history_id}")
                return False
            
            # Generate transcription ID
            import uuid
            transcription_id = str(uuid.uuid4())
            
            # IMPORTANT: Store the ID in the transcription object
            transcription.id = transcription_id
            
            # Store transcription in same table as history
            # PartitionKey = history_id, RowKey = transcription_id
            transcription_entity = {
                "PartitionKey": history_id,
                "RowKey": transcription_id,
                "entity_type": "transcription",  # Distinguish from history metadata
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
            
            # Store transcription in single table
            table_client = self.table_service.get_table_client(self.table_name)
            
            self.logger.info(f"ADD_TRANSCRIPTION: Creating entity with PartitionKey={history_id}, RowKey={transcription_id}")
            self.logger.info(f"ADD_TRANSCRIPTION: Initial status={transcription.status}, chunks={len(transcription.transcript_chunks)}")
            
            table_client.create_entity(transcription_entity)
            
            # Update history metadata - increment transcription count
            history_entity = table_client.get_entity(
                partition_key=history_id,
                row_key="main"
            )
            history_entity["transcription_count"] = history_entity.get("transcription_count", 0) + 1
            table_client.update_entity(history_entity)
            
            self.logger.info(f"ADD_TRANSCRIPTION: SUCCESS - Created transcription {transcription_id} with ID stored in object: {transcription.id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to add transcription to history: {str(e)}")
            return False
    
    def update_transcription(self, history_id: str, transcription: Transcription) -> bool:
        """Update an existing transcription with new data (status, transcript_chunks, etc)."""
        try:
            # Log update attempt details
            self.logger.info(f"UPDATE_TRANSCRIPTION: Attempting update for history_id={history_id}")
            self.logger.info(f"UPDATE_TRANSCRIPTION: transcription.id={transcription.id}")
            self.logger.info(f"UPDATE_TRANSCRIPTION: transcription.status={transcription.status}")
            self.logger.info(f"UPDATE_TRANSCRIPTION: transcript_chunks count={len(transcription.transcript_chunks)}")
            
            # Validate required fields
            if not transcription.id:
                self.logger.error(f"UPDATE_TRANSCRIPTION: FAILED - Transcription ID is required. history_id={history_id}, file_name={transcription.file_name}")
                return False
            
            if not self.use_azure_tables:
                # In-memory storage - find by ID only
                if history_id in self.memory_history:
                    for t in self.memory_history[history_id].transcriptions:
                        if t.id == transcription.id:
                            # Update the transcription with new data
                            t.status = transcription.status
                            t.transcript_chunks = transcription.transcript_chunks
                            t.timestamp = transcription.timestamp
                            self.logger.info(f"Updated transcription {t.id} in memory for history {history_id}")
                            return True
                    self.logger.error(f"Transcription {transcription.id} not found in memory history {history_id}")
                    return False
                else:
                    self.logger.error(f"History record not found in memory: {history_id}")
                    return False
            
            # Azure Tables implementation with ETag retry pattern
            return self._update_transcription_with_retry(history_id, transcription)
            
        except ResourceNotFoundError:
            self.logger.error(f"Transcription not found: history_id={history_id}, id={transcription.id}")
            return False
        except Exception as e:
            self.logger.error(f"Failed to update transcription: {str(e)}")
            return False
    
    def _update_transcription_with_retry(self, history_id: str, transcription: Transcription, max_retries: int = 3) -> bool:
        """Update transcription with optimistic concurrency and retry pattern."""
        import time
        from azure.core.exceptions import ResourceExistsError, HttpResponseError
        
        table_client = self.table_service.get_table_client(self.table_name)
        
        for attempt in range(max_retries):
            try:
                self.logger.info(f"UPDATE_RETRY: Attempt {attempt + 1}/{max_retries} for transcription {transcription.id}")
                
                # Fresh entity lookup with current ETag
                entity = table_client.get_entity(
                    partition_key=history_id,
                    row_key=transcription.id
                )
                
                self.logger.info(f"UPDATE_RETRY: Retrieved entity with ETag={entity.metadata.get('etag', 'None')}")
                
                # Update entity fields with fresh data
                entity["status"] = transcription.status
                entity["transcript_chunks"] = json.dumps([{
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
                entity["timestamp"] = transcription.timestamp.isoformat() if transcription.timestamp else None
                
                # Update with current ETag (optimistic concurrency)
                table_client.update_entity(entity, mode="replace")
                
                self.logger.info(f"UPDATE_RETRY: SUCCESS on attempt {attempt + 1} - Updated transcription {transcription.id}")
                return True
                
            except HttpResponseError as e:
                if e.status_code == 412:  # Precondition Failed - ETag mismatch
                    self.logger.warning(f"UPDATE_RETRY: ETag conflict on attempt {attempt + 1}, retrying...")
                    if attempt < max_retries - 1:
                        # Exponential backoff: 0.1s, 0.2s, 0.4s
                        sleep_time = 0.1 * (2 ** attempt)
                        time.sleep(sleep_time)
                        continue
                    else:
                        self.logger.error(f"UPDATE_RETRY: Max retries exceeded due to ETag conflicts")
                        return False
                else:
                    self.logger.error(f"UPDATE_RETRY: HTTP error {e.status_code}: {str(e)}")
                    return False
            except Exception as e:
                self.logger.error(f"UPDATE_RETRY: Unexpected error on attempt {attempt + 1}: {str(e)}")
                if attempt < max_retries - 1:
                    time.sleep(0.1 * (2 ** attempt))
                    continue
                return False
        
        return False
    

    def get_history_by_id(self, history_id: str) -> Optional[History]:
        """Get a history record by ID (efficient direct lookup)."""
        try:
            if not self.use_azure_tables:
                # In-memory storage
                return self.memory_history.get(history_id)
            
            # Azure Tables - single table lookup
            table_client = self.table_service.get_table_client(self.table_name)
            
            # Get history metadata
            entity = table_client.get_entity(
                partition_key=history_id,
                row_key="main"
            )
            
            # Get associated transcriptions from same table
            transcriptions = self._get_transcriptions_for_history(history_id)
            
            # Convert back to History object
            history_record = History(
                id=history_id,  # Use the history_id directly
                user_id=entity["user_id"],
                session_id=entity["session_id"],
                type=entity["type"],
                timestamp=entity["timestamp"],
                visible=entity["visible"],
                transcriptions=transcriptions
            )
            
            return history_record
            
        except ResourceNotFoundError:
            self.logger.warning(f"History record not found: {history_id}")
            return None
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
            
            # Azure Tables implementation - single table
            table_client = self.table_service.get_table_client(self.table_name)
            
            # Build filter query - only history metadata entities
            filter_parts = ["entity_type eq 'history'"]
            if visible_only:
                filter_parts.append("visible eq true")
            
            filter_query = " and ".join(filter_parts)
            
            # Query entities with limit
            entities = list(table_client.query_entities(
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
                    id=entity["PartitionKey"],  # history_id is now the PartitionKey
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
            if not self.use_azure_tables:
                # In-memory storage
                histories = [h for h in self.memory_history.values() if h.user_id == user_id]
                if visible_only:
                    histories = [h for h in histories if h.visible]
                return histories
            
            table_client = self.table_service.get_table_client(self.table_name)
            
            # Query by user_id field - only history metadata
            filter_parts = ["entity_type eq 'history'", f"user_id eq '{user_id}'"]
            if visible_only:
                filter_parts.append("visible eq true")
            
            filter_query = " and ".join(filter_parts)
            
            entities = list(table_client.query_entities(filter_query))
            
            # Convert to History objects
            histories = []
            for entity in entities:
                # Get transcriptions for this history
                transcriptions = self._get_transcriptions_for_history(entity["PartitionKey"])
                
                history_record = History(
                    id=entity["PartitionKey"],  # history_id is now the PartitionKey
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
            if not self.use_azure_tables:
                # In-memory storage
                histories = [h for h in self.memory_history.values() if h.session_id == session_id]
                if visible_only:
                    histories = [h for h in histories if h.visible]
                return histories
            
            table_client = self.table_service.get_table_client(self.table_name)
            
            # Query by session_id field - only history metadata
            filter_parts = ["entity_type eq 'history'", f"session_id eq '{session_id}'"]
            if visible_only:
                filter_parts.append("visible eq true")
            
            filter_query = " and ".join(filter_parts)
            
            entities = list(table_client.query_entities(filter_query))
            
            # Convert to History objects
            histories = []
            for entity in entities:
                # Get transcriptions for this history
                transcriptions = self._get_transcriptions_for_history(entity["PartitionKey"])
                
                history_record = History(
                    id=entity["PartitionKey"],  # history_id is now the PartitionKey
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
            
            # Azure Tables implementation - single table update
            table_client = self.table_service.get_table_client(self.table_name)
            
            entity = table_client.get_entity(
                partition_key=history_id,
                row_key="main"
            )
            
            entity["visible"] = visible
            table_client.update_entity(entity)
            
            self.logger.info(f"Updated history {history_id} visibility to {visible}")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to update history visibility: {str(e)}", exc_info=True)
            return False
    
    def _get_transcriptions_for_history(self, history_id: str) -> List[Transcription]:
        """Get all transcriptions for a specific history record."""
        try:
            table_client = self.table_service.get_table_client(self.table_name)
            
            # Query by partition key and entity type
            filter_query = f"PartitionKey eq '{history_id}' and entity_type eq 'transcription'"
            self.logger.info(f"Querying transcriptions: {filter_query}")
            entities = list(table_client.query_entities(filter_query))
            self.logger.info(f"Found {len(entities)} transcription entities for history {history_id}")
            
            transcriptions = []
            for entity in entities:
                self.logger.debug(f"Processing transcription entity: RowKey={entity.get('RowKey')}, status={entity.get('status')}")
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
                    id=entity.get("RowKey"),  # Include the ID from Azure Tables
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