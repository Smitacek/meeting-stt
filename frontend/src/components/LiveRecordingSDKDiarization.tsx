import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Mic, MicOff, Loader2, AlertCircle, Users, Wifi } from 'lucide-react';
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
  onTranscriptionUpdate?: (results: TranscriptionResult[]) => void;
  onSessionEnd?: (fullTranscription: TranscriptionResult[]) => void;
}

const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:8000';

export const LiveRecordingSDKDiarization: React.FC<LiveRecordingSDKProps> = ({
  onTranscriptionUpdate,
  onSessionEnd
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptionResults, setTranscriptionResults] = useState<TranscriptionResult[]>([]);
  const [speakerColors, setSpeakerColors] = useState<Record<string, string>>({});
  const [serviceInfo, setServiceInfo] = useState<{token?: string, region?: string, azure_available?: boolean} | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  const conversationRef = useRef<SpeechSDK.ConversationTranscriber | null>(null);
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
      
      console.log('Starting Azure Speech SDK recording with diarization...');
      
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
    
    // Call session end callback
    if (onSessionEnd) {
      onSessionEnd(transcriptionResults);
    }
    
    setIsRecording(false);
    setConnectionStatus('disconnected');
    console.log(`Azure Speech session ended. Total results: ${transcriptionResults.length}`);
  }, [transcriptionResults, onSessionEnd]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.close();
      }
    };
  }, []);
  
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
            <Button 
              onClick={stopRecording} 
              variant="destructive"
              className="gap-2"
            >
              <MicOff className="h-4 w-4" />
              Zastavit nahrávání
            </Button>
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