import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mic, MicOff, Loader2, AlertCircle, Users, Zap } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TranscriptionResult {
  speaker: string;
  text: string;
  offset: number;
  duration: number;
  timestamp: number;
  confidence?: number;
}

interface LiveRecordingStatelessProps {
  onTranscriptionUpdate?: (results: TranscriptionResult[]) => void;
  onSessionEnd?: (fullTranscription: TranscriptionResult[]) => void;
}

const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:8000';

export const LiveRecordingStateless: React.FC<LiveRecordingStatelessProps> = ({
  onTranscriptionUpdate,
  onSessionEnd
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionResults, setTranscriptionResults] = useState<TranscriptionResult[]>([]);
  const [speakerColors, setSpeakerColors] = useState<Record<string, string>>({});
  const [totalChunks, setTotalChunks] = useState(0);
  const [serviceInfo, setServiceInfo] = useState<{service?: string, azure_available?: boolean} | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkCountRef = useRef<number>(0);
  const isRecordingRef = useRef<boolean>(false);
  const audioBufferRef = useRef<Blob[]>([]);
  const lastProcessTimeRef = useRef<number>(0);
  const sessionIdRef = useRef<string>('');
  
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
  
  // Process audio chunk - continuous session approach
  const processAudioChunk = useCallback(async (audioBlob: Blob) => {
    try {
      const formData = new FormData();
      formData.append('audio_file', audioBlob, 'chunk.webm');
      formData.append('session_id', sessionIdRef.current);
      
      const response = await fetch(`${BASE_URL}/live/transcribe`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      
      const data = await response.json();
      
      // Always update chunk count and service info, even for empty results
      chunkCountRef.current += 1;
      setTotalChunks(chunkCountRef.current);
      
      // Update service info from chunk_info
      if (data.chunk_info?.service) {
        setServiceInfo(prev => ({
          ...prev,
          service: data.chunk_info.service
        }));
      }
      
      // Process transcription results if any
      if (data.results && data.results.length > 0) {
        const newResults = data.results as TranscriptionResult[];
        
        // Add client-side timestamp for ordering
        const clientTimestamp = Date.now();
        const processedResults = newResults.map((result, index) => ({
          ...result,
          clientTimestamp: clientTimestamp + index
        }));
        
        setTranscriptionResults(prev => [...prev, ...processedResults]);
        
        if (onTranscriptionUpdate) {
          onTranscriptionUpdate(processedResults);
        }
        
        console.log(`Chunk ${chunkCountRef.current}: ${newResults.length} results, service: ${data.chunk_info?.service || 'unknown'}`);
      } else {
        // Log empty results but continue
        console.log(`Chunk ${chunkCountRef.current}: empty results (silence/unclear audio), service: ${data.chunk_info?.service || 'unknown'}`);
      }
      
    } catch (err) {
      console.error('Failed to process audio chunk:', err);
      // Don't set error state for processing failures - just log and continue
      // This ensures continuous recording even when individual chunks fail
      console.log('Continuing recording despite chunk processing error');
    }
  }, [onTranscriptionUpdate]);
  
  // Start recording
  const startRecording = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);
      setTranscriptionResults([]);
      setSpeakerColors({});
      setTotalChunks(0);
      chunkCountRef.current = 0;
      audioBufferRef.current = [];
      lastProcessTimeRef.current = Date.now();
      sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Check service status
      try {
        const statusResponse = await fetch(`${BASE_URL}/live/status`);
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          setServiceInfo({
            service: statusData.azure_speech_available ? 'Azure Speech Service' : 'Mock Service',
            azure_available: statusData.azure_speech_available
          });
          console.log('Service status:', statusData);
        }
      } catch (err) {
        console.log('Could not fetch service status:', err);
      }
      
      // Request microphone access with optimal settings for Azure Speech
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,           // Azure Speech preferred rate
          sampleSize: 16,              // 16-bit
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } as any  // Use 'any' to allow Chrome-specific properties
      });
      
      // Create MediaRecorder - try different formats for better Azure compatibility
      const supportedTypes = [
        'audio/webm;codecs=pcm',        // Uncompressed PCM in WebM
        'audio/webm;codecs=opus',       // Original format
        'audio/webm',                   // Generic WebM
        'audio/ogg;codecs=opus',        // OGG Opus
        'audio/ogg',                    // Generic OGG
        'audio/mp4'                     // MP4 fallback
      ];
      
      let mimeType = '';
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          console.log(`Selected audio format: ${type}`);
          break;
        }
      }
      
      if (!mimeType) {
        throw new Error('Žádný podporovaný audio formát není k dispozici');
      }
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audioBitsPerSecond: 64000  // Lower bitrate for better Azure compatibility
      });
      
      console.log('Using audio format:', mimeType);
      mediaRecorderRef.current = mediaRecorder;
      
      // Handle data available - accumulate audio for longer processing intervals
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log(`MediaRecorder data available: ${event.data.size} bytes`);
          
          // Add to buffer
          audioBufferRef.current.push(event.data);
          const now = Date.now();
          
          // Process accumulated audio every 16 seconds (2 chunks) or if buffer gets large
          const timeSinceLastProcess = now - lastProcessTimeRef.current;
          const shouldProcess = timeSinceLastProcess >= 16000 || audioBufferRef.current.length >= 3;
          
          if (shouldProcess && audioBufferRef.current.length > 0) {
            // Create combined blob from buffer
            const combinedBlob = new Blob(audioBufferRef.current, { type: mimeType });
            console.log(`Processing accumulated audio: ${combinedBlob.size} bytes from ${audioBufferRef.current.length} chunks`);
            
            processAudioChunk(combinedBlob);
            audioBufferRef.current = [];
            lastProcessTimeRef.current = now;
          }
        }
      };
      
      // Handle stop event - only log, no restart needed
      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped');
      };
      
      // Start continuous recording with 8-second timeslices
      // Longer chunks give Azure Speech Service more context for recognition
      mediaRecorder.start(8000);
      setIsRecording(true);
      isRecordingRef.current = true;
      setIsConnecting(false);
      
      console.log('Started continuous recording with 8-second timeslices');
      
    } catch (err) {
      console.error('Failed to start recording:', err);
      setError(err instanceof Error ? err.message : 'Nepodařilo se spustit nahrávání');
      setIsConnecting(false);
    }
  }, [processAudioChunk]);
  
  // Stop recording
  const stopRecording = useCallback(async () => {
    console.log('Stopping recording...');
    
    // Stop media recorder - this will trigger final ondataavailable event
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      mediaRecorderRef.current = null;
    }
    
    // Process any remaining buffered audio
    if (audioBufferRef.current.length > 0) {
      const finalBlob = new Blob(audioBufferRef.current, { type: 'audio/webm' });
      console.log(`Processing final buffered audio: ${finalBlob.size} bytes`);
      await processAudioChunk(finalBlob);
      audioBufferRef.current = [];
    }
    
    // Stop Azure Speech session
    if (sessionIdRef.current) {
      try {
        const stopFormData = new FormData();
        stopFormData.append('session_id', sessionIdRef.current);
        
        const stopResponse = await fetch(`${BASE_URL}/live/stop`, {
          method: 'POST',
          body: stopFormData,
        });
        
        if (stopResponse.ok) {
          console.log(`Azure Speech session stopped: ${sessionIdRef.current}`);
        }
      } catch (err) {
        console.error('Failed to stop Azure Speech session:', err);
      }
    }
    
    // Call session end callback
    if (onSessionEnd) {
      onSessionEnd(transcriptionResults);
    }
    
    setIsRecording(false);
    isRecordingRef.current = false;
    console.log(`Recording stopped. Total chunks processed: ${chunkCountRef.current}`);
  }, [processAudioChunk, transcriptionResults, onSessionEnd]);
  
  // Cleanup on unmount - only run once
  useEffect(() => {
    return () => {
      // Use ref to check recording state to avoid dependency issues
      if (isRecordingRef.current) {
        console.log('Component unmounting, stopping recording...');
        // Stop media recorder directly in cleanup
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
      }
    };
  }, []); // Empty dependency array - only run on unmount
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-500" />
          Live Transcription (Stateless)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Real-time transcription without session storage • Replica-friendly
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
          
          {totalChunks > 0 && (
            <span className="text-sm text-muted-foreground">
              Chunks: {totalChunks}
            </span>
          )}
          
          {serviceInfo?.service && (
            <Badge variant={serviceInfo.azure_available ? "default" : "secondary"}>
              {serviceInfo.azure_available ? "Azure Speech" : "Mock Service"}
            </Badge>
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
            <Zap className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-sm">
              Klikněte na "Spustit nahrávání" pro začátek live transkripce
            </p>
            <p className="text-xs mt-2">
              Stateless architektura - funguje s multiple replicas
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};