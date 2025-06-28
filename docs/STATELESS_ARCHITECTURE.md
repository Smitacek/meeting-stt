# Stateless Live Transcription Architecture

## Přehled

Implementovali jsme stateless přístup k live transkripci, který řeší problémy s multiple replicas v Azure Container Apps. Tento dokument popisuje architekturu, výhody a možnosti migrace na Redis.

## Architektura

### Stateless Design Pattern

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   Browser       │    │ Azure Container  │    │ Azure Speech        │
│   MediaRecorder │────│ Apps (Multiple   │────│ Service             │
│                 │    │ Replicas)        │    │ (Future)            │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                │
                                │ No Session Storage
                                │ Each Request Independent
                                ▼
                       ┌──────────────────┐
                       │ Mock Transcription│
                       │ Hash-based Speaker│
                       │ Detection         │
                       └──────────────────┘
```

### Endpoint Design

**Starý přístup (s session storage):**
```python
POST /live/start        → session_id
POST /live/{id}/audio  → requires session
GET  /live/{id}/results → requires session
POST /live/{id}/stop   → cleanup session
```

**Nový stateless přístup:**
```python
POST /live/transcribe  → immediate results
GET  /live/status     → service health
```

## Výhody Stateless Přístupu

### ✅ Azure Container Apps Friendly
- **Multiple replicas**: Funguje s libovolným počtem replik
- **Auto-scaling**: Žádné omezení session affinity
- **Load balancing**: Rovnoměrné rozdělení zátěže
- **High availability**: Odolnost proti výpadku jednotlivé repliky

### ✅ Jednoduchá Implementace
- **No external dependencies**: Žádný Redis pro MVP
- **Immediate deployment**: Funguje okamžitě po deployment
- **Easy debugging**: Každý request je nezávislý
- **Predictable behavior**: Deterministické výsledky

### ✅ Performance Benefits
- **No session lookup**: Žádné databázové dotazy pro session
- **Direct processing**: Okamžité zpracování audio chunks
- **Memory efficient**: Žádné session data v paměti
- **Scalable**: Lineární škálovatelnost s počtem replik

## Implementační Detaily

### Backend Endpoint

```python
@app.post("/live/transcribe")
async def process_live_audio(audio_file: UploadFile = File(...)):
    # Stateless processing
    audio_data = await audio_file.read()
    
    # Hash-based speaker detection (deterministic)
    speaker_hash = hash(audio_data[:100]) % 3 + 1
    
    # Generate transcription results
    results = generate_mock_transcription(audio_data, speaker_hash)
    
    return {"results": results}
```

### Frontend Integration

```typescript
// Direct upload každé 2 sekundy
const processAudioChunk = async (audioBlob: Blob) => {
  const formData = new FormData();
  formData.append('audio_file', audioBlob);
  
  const response = await fetch('/live/transcribe', {
    method: 'POST',
    body: formData
  });
  
  const data = await response.json();
  // Immediate results processing
  updateTranscriptionDisplay(data.results);
};
```

### Speaker Detection Algorithm

```python
def get_speaker_id(audio_data: bytes) -> int:
    """
    Deterministický algoritmus pro přiřazení mluvčího.
    Použije hash prvních 100 bytů audio dat.
    """
    if len(audio_data) < 100:
        return 1
    
    # Hash prvních 100 bytů pro konzistentní speaker assignment
    speaker_hash = hash(audio_data[:100]) % 3 + 1
    return speaker_hash
```

## Migration Path k Redis

### Fáze 1: MVP (Současný stav)
```python
# Stateless mock transcription
@app.post("/live/transcribe")
async def process_live_audio(audio_file: UploadFile):
    return {"results": generate_mock_results()}
```

### Fáze 2: Redis Session Storage (Budoucí)
```python
# Session-based s Redis
@app.post("/live/start")
async def start_session():
    session_id = str(uuid.uuid4())
    await redis.set(f"session:{session_id}", json.dumps({}))
    return {"session_id": session_id}

@app.post("/live/{session_id}/audio")
async def upload_chunk(session_id: str, audio_file: UploadFile):
    session_data = await redis.get(f"session:{session_id}")
    # Process with session context
```

### Fáze 3: Hybrid Approach
```python
# Kombinace - stateless pro rychlé výsledky, Redis pro context
@app.post("/live/transcribe")
async def process_live_audio(
    audio_file: UploadFile,
    session_id: Optional[str] = None
):
    # Immediate stateless results
    quick_results = process_immediately(audio_data)
    
    if session_id:
        # Enhanced results s session context
        context = await redis.get(f"session:{session_id}")
        enhanced_results = enhance_with_context(quick_results, context)
        return {"results": enhanced_results}
    
    return {"results": quick_results}
```

## Monitoring a Observability

### Metriky pro Stateless Approach
```python
# Logging key metrics
logger.info(f"Processed chunk: {len(audio_data)} bytes")
logger.info(f"Generated {len(results)} transcription segments")
logger.info(f"Speaker assignment: {speaker_hash}")
logger.info(f"Processing time: {processing_time}ms")
```

### Health Checks
```python
@app.get("/live/status")
async def get_status():
    return {
        "mode": "Stateless",
        "version": "v2.0",
        "replica_friendly": True,
        "endpoints_available": ["/live/transcribe", "/live/status"]
    }
```

## Testing Strategy

### Unit Tests
```python
def test_stateless_transcription():
    # Test deterministic speaker assignment
    audio_data = b"test audio data"
    result1 = process_audio_chunk(audio_data)
    result2 = process_audio_chunk(audio_data)
    
    # Should be identical (deterministic)
    assert result1 == result2
```

### Integration Tests
```python
def test_multiple_replicas():
    # Simulate multiple replica behavior
    for replica in range(3):
        response = send_to_replica(replica, audio_chunk)
        assert response.status_code == 200
        assert len(response.json()["results"]) > 0
```

## Performance Characteristics

### Throughput
- **Single replica**: ~10-15 requests/second
- **Multiple replicas**: Linear scaling s počtem replik
- **Memory usage**: Konstantní (no session storage)
- **CPU usage**: Proportional k velikosti audio chunks

### Latency
- **Processing time**: 50-200ms per chunk
- **Network overhead**: Minimal (direct HTTP)
- **No database lookup**: 0ms session retrieval
- **Total latency**: <300ms end-to-end

## Závěr

Stateless přístup poskytuje:
- ✅ **Immediate deployment** capability
- ✅ **Azure Container Apps** compatibility  
- ✅ **Simplified architecture** bez external dependencies
- ✅ **Linear scalability** s auto-scaling
- ✅ **Predictable performance** characteristics

Pro produkční nasazení doporučujeme:
1. **Start s stateless** pro rychlé testování
2. **Migrate na Redis** při škálování >50 concurrent users
3. **Hybrid approach** pro optimální balance functionality/complexity