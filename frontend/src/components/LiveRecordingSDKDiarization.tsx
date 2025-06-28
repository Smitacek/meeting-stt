import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mic, Loader2, AlertCircle, Users, Wifi, Pause, Play, Clock, Square, Volume2, VolumeX } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk';

interface TranscriptionResult {
  speaker: string;
  text: string;
  offset: number;
  duration: number;
  timestamp: number;
  confidence?: number;
}

interface LiveRecordingSDKProps {
  onTranscriptionStart?: () => void;
  onTranscriptionUpdate?: (results: TranscriptionResult[]) => void;
  onSessionEnd?: (fullTranscription: TranscriptionResult[]) => void;
  timeLimit?: number; // Time limit in minutes, default 60
}

const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:8000';

export const LiveRecordingSDKDiarization: React.FC<LiveRecordingSDKProps> = ({
  onTranscriptionStart,
  onTranscriptionUpdate,
  onSessionEnd,
  timeLimit = 60 // Default 60 minutes
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionResults, setTranscriptionResults] = useState<TranscriptionResult[]>([]);
  const [speakerColors, setSpeakerColors] = useState<Record<string, string>>({});
  const [serviceInfo, setServiceInfo] = useState<{token?: string, region?: string, azure_available?: boolean} | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  // Session timing
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [pausedTime, setPausedTime] = useState<number>(0); // Total paused time in ms
  const [lastPauseTime, setLastPauseTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0); // Current elapsed time in seconds
  
  // Audio level monitoring
  const [audioLevel, setAudioLevel] = useState<number>(0); // 0-100%
  const [isAudioTooLow, setIsAudioTooLow] = useState<boolean>(false);
  const [isAudioTooHigh, setIsAudioTooHigh] = useState<boolean>(false);
  
  const conversationRef = useRef<SpeechSDK.ConversationTranscriber | null>(null);
  const sessionIdRef = useRef<string>('');
  const timeUpdateIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  
  // Utility functions for time management
  const formatTime = useCallback((seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);
  
  const getElapsedSeconds = useCallback(() => {
    if (!sessionStartTime) return 0;
    const now = Date.now();
    const totalElapsed = now - sessionStartTime;
    const actualElapsed = totalElapsed - pausedTime;
    return Math.floor(actualElapsed / 1000);
  }, [sessionStartTime, pausedTime]);
  
  const getRemainingSeconds = useCallback(() => {
    const elapsed = getElapsedSeconds();
    const limitSeconds = timeLimit * 60;
    return Math.max(0, limitSeconds - elapsed);
  }, [getElapsedSeconds, timeLimit]);
  
  const getProgressPercentage = useCallback(() => {
    const elapsed = getElapsedSeconds();
    const limitSeconds = timeLimit * 60;
    return Math.min(100, (elapsed / limitSeconds) * 100);
  }, [getElapsedSeconds, timeLimit]);
  
  // Audio level monitoring functions
  const setupAudioLevelMonitoring = useCallback(async () => {
    try {
      // Get microphone stream (same constraints as Azure Speech SDK)
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000  // Match Azure Speech SDK
        } 
      });
      
      microphoneStreamRef.current = stream;
      
      // Create Web Audio API context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      
      // Create analyser node for audio level detection
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      
      // Connect microphone to analyser
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      // Start audio level monitoring
      startAudioLevelAnalysis();
      
      console.log('Audio level monitoring setup complete');
      return stream;
      
    } catch (error) {
      console.error('Failed to setup audio level monitoring:', error);
      throw error;
    }
  }, []);
  
  const startAudioLevelAnalysis = useCallback(() => {
    if (!analyserRef.current) return;
    
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const updateAudioLevel = () => {
      if (!analyser) {
        return;
      }
      
      // Continue monitoring even when transcription is paused
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate RMS (Root Mean Square) for more accurate level detection
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += (dataArray[i] / 255) * (dataArray[i] / 255);
      }
      const rms = Math.sqrt(sum / bufferLength);
      const level = Math.round(rms * 100);
      
      setAudioLevel(level);
      
      // Threshold detection
      setIsAudioTooLow(level < 5);  // Less than 5% - too quiet
      setIsAudioTooHigh(level > 85); // More than 85% - too loud
      
      animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
    };
    
    updateAudioLevel();
  }, [isPaused]);
  
  const stopAudioLevelMonitoring = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    // Stop microphone stream
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach(track => track.stop());
      microphoneStreamRef.current = null;
    }
    
    // Reset audio level state
    setAudioLevel(0);
    setIsAudioTooLow(false);
    setIsAudioTooHigh(false);
    
    console.log('Audio level monitoring stopped');
  }, []);
  
  // Color palette for speakers
  const colorPalette = [
    'text-blue-600',
    'text-green-600', 
    'text-purple-600',
    'text-orange-600',
    'text-pink-600',
    'text-teal-600'
  ];
  
  // Assign color to speaker
  const getSpeakerColor = useCallback((speaker: string) => {
    if (!speakerColors[speaker]) {
      const colorIndex = Object.keys(speakerColors).length % colorPalette.length;
      setSpeakerColors(prev => ({
        ...prev,
        [speaker]: colorPalette[colorIndex]
      }));
      return colorPalette[colorIndex];
    }
    return speakerColors[speaker];
  }, [speakerColors]);
  
  // Timer management effect
  useEffect(() => {
    if (isRecording && !isPaused) {
      // Update current time every second
      timeUpdateIntervalRef.current = setInterval(() => {
        const elapsed = getElapsedSeconds();
        setCurrentTime(elapsed);
        
        // Check if we've reached the time limit
        if (elapsed >= timeLimit * 60) {
          console.log('Time limit reached, stopping recording');
          handleStop();
        }
      }, 1000);
    } else {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
        timeUpdateIntervalRef.current = null;
      }
    }
    
    return () => {
      if (timeUpdateIntervalRef.current) {
        clearInterval(timeUpdateIntervalRef.current);
      }
    };
  }, [isRecording, isPaused, getElapsedSeconds, timeLimit]);
  
  // Get Azure Speech token from backend
  const getAzureToken = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/live/token`);
      const data = await response.json();
      
      if (!response.ok) {
        console.error('Token response error:', data);
        throw new Error(data.error || `Failed to get token: ${response.status}`);
      }
      
      console.log('Token response:', data);
      return data;
    } catch (err) {
      console.error('Failed to get Azure token:', err);
      throw err;
    }
  }, []);
  
  // Setup Azure Speech SDK with ConversationTranscriber
  const setupAzureSpeech = useCallback(async (tokenData: any) => {
    try {
      if (!tokenData.success) {
        throw new Error(tokenData.error || 'Token generation failed');
      }
      
      console.log('Setting up Azure Speech SDK with ConversationTranscriber, region:', tokenData.region);
      
      // Create speech config based on auth method
      let speechConfig: SpeechSDK.SpeechConfig;
      
      if (tokenData.auth_method === 'subscription_key' && tokenData.key) {
        // Use subscription key directly
        speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
          tokenData.key,
          tokenData.region
        );
      } else if (tokenData.token) {
        // Use authorization token
        speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
          tokenData.token,
          tokenData.region
        );
      } else {
        throw new Error('No valid authentication method available');
      }
      
      // Configure for Czech language
      speechConfig.speechRecognitionLanguage = 'cs-CZ';
      
      // Setup audio config from microphone
      const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
      
      // Create ConversationTranscriber for diarization
      const conversationTranscriber = new SpeechSDK.ConversationTranscriber(speechConfig, audioConfig);
      
      // Setup event handlers
      conversationTranscriber.transcribing = (_, e) => {
        console.log('Transcribing:', e.result.text);
        setConnectionStatus('connected');
      };
      
      conversationTranscriber.transcribed = (_, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text.trim()) {
          console.log('Transcribed:', e.result.text, 'Speaker:', e.result.speakerId);
          
          // Map speaker ID to friendly name
          const speakerName = e.result.speakerId ? `Mluvčí ${e.result.speakerId}` : 'Neznámý mluvčí';
          
          const result: TranscriptionResult = {
            speaker: speakerName,
            text: e.result.text,
            offset: e.result.offset / 10000000, // Convert to seconds
            duration: e.result.duration / 10000000, // Convert to seconds
            timestamp: Date.now() / 1000,
            confidence: 0.95
          };
          
          setTranscriptionResults(prev => [...prev, result]);
          
          if (onTranscriptionUpdate) {
            onTranscriptionUpdate([result]);
          }
        }
      };
      
      conversationTranscriber.canceled = (_, e) => {
        console.error('ConversationTranscriber canceled:', e.reason, e.errorDetails);
        setConnectionStatus('disconnected');
        
        if (e.reason === SpeechSDK.CancellationReason.Error) {
          setError(`Azure Speech error: ${e.errorDetails}`);
        }
      };
      
      conversationTranscriber.sessionStarted = (_, __) => {
        console.log('Azure Speech session started');
        setConnectionStatus('connected');
      };
      
      conversationTranscriber.sessionStopped = (_, __) => {
        console.log('Azure Speech session stopped');
        setConnectionStatus('disconnected');
      };
      
      return conversationTranscriber;
      
    } catch (err) {
      console.error('Failed to setup Azure Speech:', err);
      throw err;
    }
  }, [onTranscriptionUpdate]);
  
  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setTranscriptionResults([]);
      setSpeakerColors({});
      setConnectionStatus('connecting');
      sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Initialize session timing
      setSessionStartTime(Date.now());
      setPausedTime(0);
      setLastPauseTime(null);
      setCurrentTime(0);
      setIsPaused(false);
      
      console.log('Starting Azure Speech SDK recording with diarization...');
      
      // Setup audio level monitoring first
      await setupAudioLevelMonitoring();
      
      // Get token from backend
      const tokenData = await getAzureToken();
      setServiceInfo(tokenData);
      
      if (!tokenData.success) {
        // Check if this is mock mode
        if (tokenData.mock_mode) {
          throw new Error('Azure Speech Service není nakonfigurován. Backend běží v mock režimu.');
        }
        throw new Error(tokenData.error || 'Failed to get Azure Speech token');
      }
      
      // Setup Azure Speech SDK
      const conversationTranscriber = await setupAzureSpeech(tokenData);
      conversationRef.current = conversationTranscriber;
      
      // Start continuous transcription
      conversationTranscriber.startTranscribingAsync(
        () => {
          console.log('Azure Speech conversation transcription started');
          setIsRecording(true);
          setIsConnecting(false);
          setConnectionStatus('connected');
          
          // Notify parent about transcription start
          if (onTranscriptionStart) {
            onTranscriptionStart();
          }
        },
        (err) => {
          console.error('Failed to start transcription:', err);
          setError(`Failed to start transcription: ${err}`);
          setIsConnecting(false);
          setConnectionStatus('disconnected');
        }
      );
      
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se spustit nahrávání');
      setIsConnecting(false);
      setConnectionStatus('disconnected');
    }
  }, [getAzureToken, setupAzureSpeech]);
  
  // Stop recording
  const stopRecording = useCallback(async () => {
    console.log('Stopping Azure Speech recording...');
    
    if (conversationRef.current) {
      conversationRef.current.stopTranscribingAsync(
        () => {
          console.log('Azure Speech transcription stopped');
          conversationRef.current?.close();
          conversationRef.current = null;
        },
        (err) => {
          console.error('Error stopping transcription:', err);
          conversationRef.current?.close();
          conversationRef.current = null;
        }
      );
    }
    
    // Stop audio level monitoring
    stopAudioLevelMonitoring();
    
    // Call session end callback
    if (onSessionEnd) {
      onSessionEnd(transcriptionResults);
    }
    
    setIsRecording(false);
    setIsPaused(false);
    setConnectionStatus('disconnected');
    console.log(`Azure Speech session ended. Total results: ${transcriptionResults.length}`);
  }, [transcriptionResults, onSessionEnd]);
  
  // Pause recording
  const pauseRecording = useCallback(() => {
    console.log('Pausing Azure Speech recording...');
    
    if (conversationRef.current) {
      conversationRef.current.stopTranscribingAsync(
        () => {
          console.log('Azure Speech transcription paused');
          setIsPaused(true);
          
          // Track pause time
          setLastPauseTime(Date.now());
        },
        (err) => {
          console.error('Error pausing transcription:', err);
          setError('Nepodařilo se pozastavit nahrávání');
        }
      );
    }
  }, []);
  
  // Resume recording  
  const resumeRecording = useCallback(async () => {
    console.log('Resuming Azure Speech recording...');
    
    if (!serviceInfo) {
      setError('Chybí informace o službě');
      return;
    }
    
    try {
      // Calculate accumulated pause time
      if (lastPauseTime) {
        const pauseDuration = Date.now() - lastPauseTime;
        setPausedTime(prev => prev + pauseDuration);
        setLastPauseTime(null);
      }
      
      // Restart Azure Speech SDK
      await setupAzureSpeech(serviceInfo);
      
      if (conversationRef.current) {
        conversationRef.current.startTranscribingAsync(
          () => {
            console.log('Azure Speech transcription resumed');
            setIsPaused(false);
            setConnectionStatus('connected');
          },
          (err) => {
            console.error('Error resuming transcription:', err);
            setError('Nepodařilo se obnovit nahrávání');
          }
        );
      }
    } catch (err) {
      console.error('Failed to resume recording:', err);
      setError('Nepodařilo se obnovit nahrávání');
    }
  }, [serviceInfo, setupAzureSpeech, lastPauseTime]);
  
  // Stop recording (wrapper for compatibility)
  const handleStop = useCallback(() => {
    stopRecording();
  }, [stopRecording]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.close();
      }
      stopAudioLevelMonitoring();
    };
  }, [stopAudioLevelMonitoring]);
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-blue-500" />
          Live Transcription s diarizací (Azure Speech SDK)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Direct Azure Speech Service connection • Real-time WebSocket streaming • Rozpoznávání mluvčích
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Control buttons */}
        <div className="flex items-center gap-4">
          {!isRecording ? (
            <Button 
              onClick={startRecording} 
              disabled={isConnecting}
              className="gap-2"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Připojování k Azure...
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  Spustit nahrávání s diarizací
                </>
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {!isPaused ? (
                <Button 
                  onClick={pauseRecording} 
                  variant="outline"
                  className="gap-2"
                >
                  <Pause className="h-4 w-4" />
                  Pozastavit
                </Button>
              ) : (
                <Button 
                  onClick={resumeRecording} 
                  variant="default"
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Pokračovat
                </Button>
              )}
              
              <Button 
                onClick={stopRecording} 
                variant="destructive"
                className="gap-2"
              >
                <Square className="h-4 w-4" />
                Zastavit
              </Button>
            </div>
          )}
          
          {/* Connection status */}
          <Badge 
            variant={connectionStatus === 'connected' ? 'default' : connectionStatus === 'connecting' ? 'secondary' : 'outline'}
            className={connectionStatus === 'connected' ? 'animate-pulse' : ''}
          >
            {connectionStatus === 'connected' && <div className="h-2 w-2 bg-green-500 rounded-full mr-2" />}
            {connectionStatus === 'connecting' && <Loader2 className="h-3 w-3 animate-spin mr-2" />}
            {connectionStatus === 'connected' ? 'Připojeno' : connectionStatus === 'connecting' ? 'Připojování...' : 'Odpojeno'}
          </Badge>
          
          {serviceInfo?.azure_available && (
            <Badge variant="default">
              Azure Speech SDK + Diarizace
            </Badge>
          )}
          
          {transcriptionResults.length > 0 && (
            <span className="text-sm text-muted-foreground">
              Výsledky: {transcriptionResults.length}
            </span>
          )}
        </div>
        
        {/* Audio Level Meter */}
        {(isRecording || isConnecting) && (
          <div className="p-4 bg-muted/30 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Audio Input Level</span>
              </div>
              <span className="text-sm text-muted-foreground">
                {audioLevel}%
              </span>
            </div>
            
            {/* Audio level progress bar */}
            <div className="w-full bg-muted rounded-full h-3 mb-2">
              <div 
                className={`h-3 rounded-full transition-all duration-150 ${
                  isAudioTooHigh ? 'bg-red-500' : 
                  isAudioTooLow ? 'bg-yellow-500' : 
                  audioLevel > 50 ? 'bg-green-500' : 
                  audioLevel > 20 ? 'bg-blue-500' : 
                  'bg-gray-400'
                }`}
                style={{ width: `${Math.min(audioLevel, 100)}%` }}
              />
            </div>
            
            {/* Audio level warnings */}
            {isAudioTooLow && (
              <div className="flex items-center gap-2 text-yellow-600 text-sm">
                <VolumeX className="h-4 w-4" />
                <span>Příliš tichý vstup - mluvte blíže k mikrofonu</span>
              </div>
            )}
            
            {isAudioTooHigh && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <Volume2 className="h-4 w-4" />
                <span>Příliš hlasitý vstup - snižte hlasitost nebo vzdalte se od mikrofonu</span>
              </div>
            )}
            
            {!isAudioTooLow && !isAudioTooHigh && audioLevel > 0 && (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <Volume2 className="h-4 w-4" />
                <span>Optimální úroveň audio vstupu</span>
              </div>
            )}
          </div>
        )}
        
        {/* Session progress and time limit */}
        {isRecording && (
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {formatTime(currentTime)} / {formatTime(timeLimit * 60)}
                </span>
                {isPaused && (
                  <Badge variant="secondary" className="ml-2">
                    Pozastaveno
                  </Badge>
                )}
              </div>
              <span className="text-sm text-muted-foreground">
                Zbývá: {formatTime(getRemainingSeconds())}
              </span>
            </div>
            
            {/* Progress bar */}
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className={`h-2 rounded-full transition-all duration-1000 ${
                  getProgressPercentage() > 90 ? 'bg-red-500' : 
                  getProgressPercentage() > 75 ? 'bg-yellow-500' : 
                  'bg-blue-500'
                }`}
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
            
            {/* Warning when approaching limit */}
            {getProgressPercentage() > 90 && (
              <div className="flex items-center gap-2 text-red-600 text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>Blíží se časový limit! Session bude automaticky ukončena.</span>
              </div>
            )}
          </div>
        )}
        
        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {/* Speaker colors legend */}
        {Object.keys(speakerColors).length > 0 && (
          <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
            <Users className="h-4 w-4 text-muted-foreground" />
            <div className="flex gap-3 flex-wrap">
              {Object.entries(speakerColors).map(([speaker, color]) => (
                <span key={speaker} className={`text-sm font-medium ${color}`}>
                  {speaker}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Transcription results */}
        {transcriptionResults.length > 0 && (
          <div className="space-y-2 max-h-96 overflow-y-auto p-4 bg-muted/30 rounded-lg">
            {transcriptionResults.map((result, index) => (
              <div key={index} className="space-y-1">
                <div className="flex items-baseline gap-2">
                  <span className={`font-semibold text-sm ${getSpeakerColor(result.speaker)}`}>
                    {result.speaker}:
                  </span>
                  <span className="text-sm">{result.text}</span>
                  {result.confidence && (
                    <span className="text-xs text-muted-foreground">
                      ({(result.confidence * 100).toFixed(0)}%)
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground ml-4">
                  {new Date(result.timestamp * 1000).toISOString().substr(14, 5)}
                </span>
              </div>
            ))}
          </div>
        )}
        
        {/* Instructions when not recording */}
        {!isRecording && transcriptionResults.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Wifi className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">
              Klikněte na "Spustit nahrávání s diarizací" pro začátek transkripce s rozpoznáváním mluvčích
            </p>
            <p className="text-xs mt-2">
              Přímé WebSocket spojení s Azure Speech Service • Real-time streaming • Speaker diarization
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};