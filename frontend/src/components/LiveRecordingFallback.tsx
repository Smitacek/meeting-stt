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

interface LiveRecordingFallbackProps {
  onTranscriptionUpdate?: (results: TranscriptionResult[]) => void;
  onSessionEnd?: (fullTranscription: TranscriptionResult[]) => void;
}

const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:8000';

export const LiveRecordingFallback: React.FC<LiveRecordingFallbackProps> = ({
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
  const audioChunksRef = useRef<Blob[]>([]);
  const uploadIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
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
  
  // Start live session
  const startSession = useCallback(async () => {
    try {
      const response = await fetch(`${BASE_URL}/live/start`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to start session');
      }
      
      const data = await response.json();
      setSessionId(data.session_id);
      console.log('Session started:', data.session_id);
      
    } catch (err) {
      console.error('Failed to start session:', err);
      throw err;
    }
  }, []);
  
  // Upload audio chunk
  const uploadAudioChunk = useCallback(async (audioBlob: Blob) => {
    if (!sessionId) return;
    
    try {
      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'chunk.webm');
      
      const response = await fetch(`${BASE_URL}/live/${sessionId}/audio`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to upload audio chunk');
      }
      
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        const newResults = data.results as TranscriptionResult[];
        setTranscriptionResults(prev => [...prev, ...newResults]);
        if (onTranscriptionUpdate) {
          onTranscriptionUpdate(newResults);
        }
      }
      
    } catch (err) {
      console.error('Failed to upload audio chunk:', err);
    }
  }, [sessionId, onTranscriptionUpdate]);
  
  // Poll for results
  const pollResults = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      const response = await fetch(`${BASE_URL}/live/${sessionId}/results`);
      if (!response.ok) return;
      
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        const newResults = data.results as TranscriptionResult[];
        setTranscriptionResults(prev => [...prev, ...newResults]);
        if (onTranscriptionUpdate) {
          onTranscriptionUpdate(newResults);
        }
      }
    } catch (err) {
      console.error('Failed to poll results:', err);
    }
  }, [sessionId, onTranscriptionUpdate]);
  
  // Stop session
  const stopSession = useCallback(async () => {
    if (!sessionId) return;
    
    try {
      const response = await fetch(`${BASE_URL}/live/${sessionId}/stop`, {
        method: 'POST',
      });
      if (response.ok) {
        console.log('Session stopped successfully');
      } else {
        console.log('Stop endpoint returned:', response.status, '- session probably already expired');
      }
    } catch (err) {
      console.log('Stop session failed (expected if backend not deployed):', err);
    }
  }, [sessionId]);
  
  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setTranscriptionResults([]);
      setSpeakerColors({});
      
      // Start session
      await startSession();
      
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
      
      // Create MediaRecorder
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        const types = ['audio/webm', 'audio/ogg', 'audio/mp4'];
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
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Start recording with 1000ms chunks
      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsConnecting(false);
      
      // Set up upload interval (every 2 seconds)
      uploadIntervalRef.current = setInterval(() => {
        if (audioChunksRef.current.length > 0) {
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          uploadAudioChunk(audioBlob);
          audioChunksRef.current = [];
        }
      }, 2000);
      
      // Set up polling interval (every 1 second)
      pollIntervalRef.current = setInterval(pollResults, 1000);
      
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se spustit nahrávání');
      setIsConnecting(false);
    }
  }, [startSession, uploadAudioChunk, pollResults]);
  
  // Stop recording
  const stopRecording = useCallback(async () => {
    // Clear intervals
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
      uploadIntervalRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }
    
    // Upload final chunk
    if (audioChunksRef.current.length > 0) {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      await uploadAudioChunk(audioBlob);
      audioChunksRef.current = [];
    }
    
    // Stop session
    await stopSession();
    
    // Call session end callback
    if (onSessionEnd) {
      onSessionEnd(transcriptionResults);
    }
    
    setIsRecording(false);
    setSessionId(null);
  }, [uploadAudioChunk, stopSession, transcriptionResults, onSessionEnd]);
  
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
          Live Transcription (REST API)
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
              Použije REST API místo WebSocket (kompatibilní s Azure)
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};