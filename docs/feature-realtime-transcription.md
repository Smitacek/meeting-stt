# PRD: Realtime Speech-to-Text z mikrofonu

## 1. Problém + Business Context

### Problém
Současná aplikace umožňuje pouze zpracování už nahraných audio souborů. Uživatelé potřebují možnost real-time transkripce během živých meetingů, prezentací nebo diskuzí pro:
- **Živé poznámky** během schůzek a webinářů
- **Accessibility** pro sluchově postižené účastníky
- **Dokumentaci** diskuzí bez nutnosti nahrávání a post-processing
- **Multijazykovou podporu** pro mezinárodní týmy

### Business Context
Rozšíření aplikace o real-time funktionalitu zvyšuje hodnotu produktu a umožňuje konkurovat nástrojům jako Otter.ai, Microsoft Teams transcription, nebo Google Meet captions.

## 2. Uživatelské scénáře a Pain-points

### Primární personas:
- **Moderátor schůzky**: Potřebuje živé poznámky během vedení meetingu
- **Účastník diskuze**: Chce sledovat transkripci při problémech se zvukem
- **Notetaker**: Potřebuje okamžité zachycení klíčových bodů diskuze

### User Stories:
1. **Jako moderátor** chci spustit live transkripci, abych mohl sledovat klíčové body diskuze
2. **Jako účastník** chci vidět real-time přepis, abych nezmeškał důležité informace
3. **Jako organizátor** chci uložit live transkripci do historie pro pozdější referenci
4. **Jako uživatel** chci mít kontrolu nad nahráváním (start/pause/stop)

### Pain-points:
- Současné workflow: nahrát → upload → čekat → transkripce je příliš pomalé
- Chybí okamžitá zpětná vazba během mluvení
- Není možnost real-time editace nebo označování klíčových momentů

## 3. Metriky úspěchu

### Primární KPIs:
- **Latence transkripce**: < 2 sekundy od promluvy k zobrazení textu
- **Přesnost transkripce**: > 90% pro český a anglický jazyk
- **Adoption rate**: 60%+ stávajících uživatelů vyzkouší live funkci během prvního měsíce

### Technické metriky:
- **WebSocket uptime**: > 99% dostupnost real-time spojení
- **Audio quality**: Úspěšné zachycení audio při > 95% pokusů
- **Performance**: Browser responsivity bez zadrhávání během nahrávání

## 4. Funkční specifikace

### MVP (Must Have):
1. **Live Recording Control**
   - Tlačítko "Start Live Recording" v Playground stránce
   - Real-time audio capture z mikrofonu pomocí MediaRecorder API
   - Start/Stop funkcionalita s vizuálním feedback

2. **Real-time Transcription**
   - WebSocket streaming audio chunks na backend (100-500ms segmenty)
   - Azure Speech SDK ConversationTranscriber pro live processing
   - SSE stream výsledků zpět na frontend s <2s latencí

3. **Live Display**
   - Real-time zobrazení transkripce během nahrávání
   - Postupné aktualizace textu (append mode)
   - Indikátor recording stavu (recording/paused/stopped)
   - **Speaker diarization**: Rozlišení mluvčích jako "Mluvčí 1", "Mluvčí 2" atd.

4. **Basic Error Handling**
   - Microphone permission handling
   - WebSocket reconnection při výpadku spojení
   - Fallback na error message při technických problémech

### Nice-to-Have (V2):
1. **Advanced Controls**
   - Pause/Resume funkcionalita během nahrávání
   - Výběr input audio zařízení (multiple mikrofony)
   - Nastavení kvality záznamu (sample rate, bitrate)

2. **Visual Enhancements**
   - Audio level meter pro monitoring input úrovně
   - Real-time confidence score pro transcription kvalitu
   - Barevné rozlišení mluvčích v transkripci
   - Visual indikátor aktivního mluvčího

3. **Content Management**
   - Možnost editace textu během live session
   - Označování klíčových momentů během nahrávání
   - Export live session do různých formátů

4. **Advanced Features**
   - Multi-language detection během jedné session
   - Real-time překladové možnosti
   - Integration s kalendářními systémy
   - **Budoucí V3**: Přesná identifikace mluvčích (voice profiles, jména účastníků)

## 5. Technické dopady

### Backend změny:
1. **Session-Based Streaming**: `POST /live/transcribe` s continuous Azure Speech sessions
2. **PushAudioInputStream Pipeline**:
   ```python
   HTTP Upload → WebM/Opus Direct Processing → Azure Speech PushStream → 
   Real-time ConversationTranscriber → Speaker Diarization → JSON Response
   ```
3. **Session Management**: Global sessions with automatic cleanup (`POST /live/stop`)
4. **WebM/Opus Support**: Direct processing via AudioStreamContainerFormat.ANY + GStreamer
5. **Dual Recognizer Support**: SpeechRecognizer (simple) + ConversationTranscriber (diarization)

### Frontend změny:
1. **Continuous Audio Streaming**: 
   - `getUserMedia()` s optimalizovanými constraints (16kHz, mono, echo cancellation)
   - `MediaRecorder` s 8s timeslices, audio accumulation buffer (16s segments)
   - Session ID management pro continuous Azure Speech sessions
2. **UI Components**: 
   - `LiveRecordingStateless` komponenta s session lifecycle management
   - Service status indicators (Azure vs Mock)
   - Real-time transcript display s speaker colors a chunk counters
3. **Error Resilience**: Robust error handling, session cleanup, no-stop-on-errors pattern

### Database/Storage:
- **Session Memory Storage**: In-memory sessions (`_active_sessions` dict) s automatic cleanup
- **History Integration**: Live transkripce lze ukládat do stávající History struktury
- **Audio Processing**: Temporary file processing s immediate cleanup (WebM→WAV fallback)
- **Memory Management**: Old results cleanup (30s retention), recent results filtering

### Infrastructure:
- **Azure Container Apps**: Session-based HTTP support, GStreamer dependency requirement
- **Azure Speech Service**: Real Azure integration s PushAudioInputStream + ConversationTranscriber
- **GStreamer**: Required for WebM/Opus processing (AudioStreamContainerFormat.ANY)
- **Networking**: HTTPS requirement pro getUserMedia() API
- **Session Lifecycle**: Manual cleanup via `/live/stop`, memory-resident sessions

## 6. Rizika a Open Questions

### Technická rizika:
1. **Browser Compatibility**: 
   - MediaRecorder API support v starších browsers
   - WebSocket stability napříč různými network podmínkami
   - **Mitigation**: Feature detection a graceful fallback

2. **Audio Quality/Latence**:
   - Network latence impact na user experience
   - Audio compression vs. transkripce přesnost trade-off
   - **Mitigation**: Adaptivní chunk size based na network conditions

3. **Azure Speech Service Limits**:
   - Concurrent connections rate limiting
   - Real-time pricing vs. batch processing costs
   - **Mitigation**: Connection pooling a usage monitoring

### Business rizika:
1. **User Privacy**: 
   - Live audio streaming security concerns
   - GDPR compliance pro real-time audio processing
   - **Mitigation**: Clear privacy policy a opt-in consent

2. **Performance Impact**:
   - Browser performance při dlouhých live sessions
   - Server resource consumption při multiple users
   - **Mitigation**: Resource monitoring a usage limits

### Open Questions:
1. **Pricing Model**: Jak strukturovat pricing pro real-time vs. batch processing?
2. **Session Length**: Jaký je maximální limit pro live recording session?
3. **Multi-user**: ✅ **Ano** - podporujeme multiple speakers s anonymní diarizací ("Mluvčí 1", "Mluvčí 2")
4. **Mobile Support**: Priorita mobile browser support?

## 7. Implementation Roadmap

### ✅ Sprint 1 (Completed): Stateless Backend Infrastructure
- ✅ Stateless `/live/transcribe` endpoint implementation
- ✅ Audio chunk processing pipeline s mock transcription
- ✅ Hash-based speaker detection algorithm
- ✅ Error handling a comprehensive logging
- ✅ Azure Container Apps compatible (no session storage)

### ✅ Sprint 2 (Completed): Frontend Audio Capture
- ✅ MediaRecorder API integration s audio chunking
- ✅ Direct HTTP upload client implementation
- ✅ `LiveRecordingStateless` UI komponenta
- ✅ Microphone permission handling
- ✅ Real-time transcript display s speaker colors

### ✅ Sprint 3 (Completed): Azure Speech Integration
- ✅ Azure Speech Service ConversationTranscriber integration
- ✅ FFmpeg audio conversion (WebM/Opus → WAV)
- ✅ Real speaker diarization via Azure Speech API
- ✅ Fallback system pro Azure unavailability
- ✅ Service status indicators v UI
- ✅ Comprehensive error handling a logging

### 🔄 Sprint 4 (Current): Production Testing & Deployment
- 🔄 Azure deployment s Azure Speech credentials
- 🔄 FFmpeg availability v Azure Container Apps
- 🔄 Production audio quality testing
- 🔄 Multiple replica verification s real Azure Speech
- 🔄 Performance optimization pro production workloads

### 📋 Sprint 5 (Next): Advanced Features
- Redis integration pro advanced session management
- Real-time confidence score optimization
- Enhanced speaker diarization accuracy
- Monitoring a analytics setup

## 8. Success Criteria

**MVP považujeme za úspěšný, pokud:**
1. ✅ Uživatel může spustit live recording jedním klikem
2. ✅ Transkripce se zobrazuje s latencí < 2 sekundy
3. ✅ System zvládne 10+ concurrent live sessions
4. ✅ Live session lze uložit do historie pro pozdější použití
5. ✅ 90%+ reliability při 5-minute live sessions
6. ✅ **Diarization funguje** - rozlišení 2+ mluvčích v multi-speaker prostředí

**Ready for V2 pokud:**
- User feedback > 4/5 stars pro MVP funkcionalitu
- <5% churn rate po zavedení live features
- Technical performance meets všechny definované metriky

---

## 9. Implementační Roadmap a Aktuální Stav

### Sprint 1: Základní Infrastruktura ✅ COMPLETED
- [x] MediaRecorder integration pro audio capture
- [x] Backend endpoint `/live/transcribe` pro HTTP audio upload
- [x] Frontend komponenta `LiveRecordingStateless`
- [x] Mock transcription s hash-based speaker detection
- [x] Základní UI s real-time transcript display

### Sprint 2: Azure Speech Integration 🔄 IN PROGRESS
- [x] **PushAudioInputStream implementace** - přechod z batch na streaming approach
- [x] **Session management** - globální session store s lifecycle management
- [x] **WebM/Opus direct support** - AudioStreamContainerFormat.ANY + GStreamer
- [x] **Dual recognizer support** - SpeechRecognizer vs ConversationTranscriber fallback
- [x] **Error resilience** - robust error handling, session cleanup
- [ ] **GStreamer verification** - test na Azure Container Apps environment
- [ ] **Production Azure Speech** - real credentials a production testing
- [ ] **Speaker diarization validation** - ConversationTranscriber speaker detection

### Sprint 3: Performance & Reliability 📋 PLANNED
- [ ] **Continuous recording fix** - eliminate "empty results" after first chunk
- [ ] **Audio quality optimization** - sample rate, bitrate, format tuning
- [ ] **Session scaling** - multiple concurrent sessions stress testing
- [ ] **Memory management** - session cleanup, result retention policies
- [ ] **Monitoring & logging** - Azure Speech API usage, error tracking

### Sprint 4: Production Readiness 📋 PLANNED
- [ ] **History integration** - save live sessions to existing history system
- [ ] **UI polishing** - loading states, progress indicators, error messages
- [ ] **Configuration options** - audio device selection, quality settings
- [ ] **Documentation** - user guides, troubleshooting, API documentation

### Současné Technické Výzvy (Jun 2025):

#### 🔴 KRITICKÉ: Empty Results Issue
- **Problém**: Azure Speech Service vrací "empty results" pro chunks 2+ (první chunk funguje)
- **Hypotéza**: GStreamer dependency chybí na Azure Container Apps
- **Status**: Testing WebM/Opus direct processing s AudioStreamContainerFormat.ANY
- **Next Steps**: GStreamer installation verification, fallback na REST API

#### 🟡 VYSOKÁ: Session Management
- **Problém**: In-memory sessions nejsou replica-friendly pro Azure Container Apps scaling
- **Současné řešení**: Single instance session storage
- **Budoucí řešení**: Redis session store pro multi-replica support
- **Status**: MVP using single replica, V2 migration to Redis planned

#### 🟡 STŘEDNÍ: Audio Format Optimization
- **Status**: Testing direct WebM/Opus vs WAV conversion performance
- **Findings**: Azure Speech SDK podporuje WebM přes GStreamer
- **Action**: Verify GStreamer installation on production environment

### Závěrečné Poznámky:
- **Architektura**: Úspěšný přechod z stateless na session-based approach
- **Azure Integration**: Real Azure Speech Service integration implementována
- **Frontend**: Robust continuous recording s error resilience
- **Deployment**: Ready for production testing po vyřešení GStreamer dependency