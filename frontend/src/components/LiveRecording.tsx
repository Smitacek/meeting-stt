import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mic, MicOff, Loader2, AlertCircle, Users } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TranscriptionResult {
  speaker: string;
  text: string;
  offset: number;
  duration: number;
  timestamp: number;
}

interface LiveRecordingProps {
  onTranscriptionUpdate?: (results: TranscriptionResult[]) => void;
  onSessionEnd?: (fullTranscription: TranscriptionResult[]) => void;
}

const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:8000';
const WS_URL = BASE_URL.replace(/^http/, 'ws');

export const LiveRecording: React.FC<LiveRecordingProps> = ({
  onTranscriptionUpdate,
  onSessionEnd
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcriptionResults, setTranscriptionResults] = useState<TranscriptionResult[]>([]);
  const [speakerColors, setSpeakerColors] = useState<Record<string, string>>({});
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  
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
  
  // Initialize WebSocket connection
  const connectWebSocket = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${WS_URL}/ws/transcribe`);
      
      ws.onopen = () => {
        console.log('WebSocket connected');
        websocketRef.current = ws;
        // Send audio format info
        ws.send(JSON.stringify({
          type: 'audio_format',
          format: 'webm/opus'  // Will need server-side conversion
        }));
        resolve();
      };
      
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'connection':
            setSessionId(data.session_id);
            console.log('Session established:', data.session_id);
            break;
            
          case 'transcription':
            const newResults = data.results as TranscriptionResult[];
            setTranscriptionResults(prev => [...prev, ...newResults]);
            if (onTranscriptionUpdate) {
              onTranscriptionUpdate(newResults);
            }
            break;
            
          case 'error':
            setError(data.message);
            console.error('Transcription error:', data.message);
            break;
        }
      };
      
      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('Připojení k serveru selhalo');
        reject(new Error('WebSocket connection failed'));
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        websocketRef.current = null;
      };
    });
  }, [onTranscriptionUpdate]);
  
  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setTranscriptionResults([]);
      setSpeakerColors({});
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          sampleSize: 16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Connect to WebSocket
      await connectWebSocket();
      
      // Create MediaRecorder with PCM format for Azure compatibility
      // Note: Most browsers don't support direct PCM recording, so we'll use webm
      // and need server-side conversion
      let mimeType = 'audio/webm;codecs=opus';
      
      // Check for browser support
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        // Fallback to any supported audio format
        const types = [
          'audio/webm',
          'audio/ogg',
          'audio/mp4',
        ];
        
        mimeType = types.find(type => MediaRecorder.isTypeSupported(type)) || '';
        
        if (!mimeType) {
          throw new Error('Žádný podporovaný audio formát není k dispozici');
        }
      }
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: 128000
      });
      
      console.log('Using audio format:', mimeType);
      
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      // Handle data available
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && websocketRef.current?.readyState === WebSocket.OPEN) {
          // Send audio chunk to server
          websocketRef.current.send(event.data);
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Start recording with 100ms chunks
      mediaRecorder.start(100);
      setIsRecording(true);
      setIsConnecting(false);
      
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se spustit nahrávání');
      setIsConnecting(false);
    }
  }, [connectWebSocket]);
  
  // Stop recording
  const stopRecording = useCallback(() => {
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }
    
    // Close WebSocket
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
    
    // Call session end callback
    if (onSessionEnd) {
      onSessionEnd(transcriptionResults);
    }
    
    setIsRecording(false);
    setSessionId(null);
  }, [transcriptionResults, onSessionEnd]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, [isRecording, stopRecording]);
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Live Transcription
        </CardTitle>
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
                  Připojování...
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  Spustit nahrávání
                </>
              )}
            </Button>
          ) : (
            <Button 
              onClick={stopRecording} 
              variant="destructive"
              className="gap-2"
            >
              <MicOff className="h-4 w-4" />
              Zastavit nahrávání
            </Button>
          )}
          
          {isRecording && (
            <Badge variant="default" className="animate-pulse">
              <div className="h-2 w-2 bg-red-500 rounded-full mr-2" />
              Nahrává se
            </Badge>
          )}
          
          {sessionId && (
            <span className="text-sm text-muted-foreground">
              Session: {sessionId.substring(0, 8)}...
            </span>
          )}
        </div>
        
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
            <Mic className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">
              Klikněte na "Spustit nahrávání" pro začátek live transkripce
            </p>
            <p className="text-xs mt-2">
              Ujistěte se, že máte povolený přístup k mikrofonu
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};