// Interface for uploaded file info
interface UploadedFile {
  filename: string;
  filename_original: string; // original filename for display
  inspect: {
    channels: number;
    bits_per_sample: number;
    samples_per_second: number;
    frame_rate: number;
  };
}

// // New interface for analysis response structure
// interface AnalysisResponse {
//   customer_issue: string;
//   agent_response_approach: string;
//   tone_and_sentiment: {
//     customer: string;
//     agent: string;
//   };
//   issue_resolution: string;
//   improvement_suggestions: string;
// }

import { useState, useEffect, useRef } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AppSidebar } from "@/components/app-sidebar"
import { useUserContext } from '@/contexts/UserContext'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { Card, CardContent, CardFooter, CardHeader} from "@/components/ui/card"
import { AudioLines, CloudUpload, DownloadCloud, Info, Loader2, CirclePause, CirclePlay, Search, Check } from "lucide-react"
import { ModeToggle } from '@/components/mode-toggle'
import { Input } from '@/components/ui/input';
import { useCallback } from 'react';
import { Button } from '@/components/ui/button'
// import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { 
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem 
} from "@/components/ui/select";

import axios from 'axios';
import { Footer } from "@/components/Footer";
import { MarkdownRenderer } from "@/components/markdown-display";
import { LiveRecordingSDKDiarization } from "@/components/LiveRecordingSDKDiarization";

// import AnalysisResultDisplay from "@/components/AnalysisResultDisplay";


// Define environment variables with default values
const BASE_URL = import.meta.env.VITE_BASE_URL || 'http://localhost:8000';
console.log('BASE_URL:', BASE_URL);


export default function App() {


  const [sessionTime, setSessionTime] = useState('')
  const { userInfo } = useUserContext();
  const [sessionID] = useState(userInfo.sessionId || '');

  
  


  // Upload step mode: 'local' or 'blob'
  const [uploadMode, setUploadMode] = useState<'local' | 'blob'>('local');
  // Transcription mode: 'record' or 'live'
  const [transcriptionMode, setTranscriptionMode] = useState<'record' | 'live'>('record');
  // Live session timing
  const [liveSessionStartTime, setLiveSessionStartTime] = useState<number | null>(null);
  
  // Reset state when transcription mode changes
  const handleTranscriptionModeChange = (mode: 'record' | 'live') => {
    setTranscriptionMode(mode);
    // Reset all relevant state
    setIsProcessed(false);
    setIsProcessing(false);
    setAllResults([]);
    setGroupedResults({});
    setTranscriptionResult(null);
    setAnalysisText('');
    setAnalysisResult(null);
    setUploadedFiles([]);
    setIsUploaded(false);
    setSelectedFiles([]);
    setSelectedBlobFiles([]);
    setLiveSessionStartTime(null);
    console.log(`Switched to ${mode} mode`);
  };
  // Local file upload state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Blob storage state
  const [blobFiles, setBlobFiles] = useState<string[]>([]); // all blobs fetched from backend
  const [selectedBlobFiles, setSelectedBlobFiles] = useState<string[]>([]); // user-selected blobs
  const [isLoadingBlobs, setIsLoadingBlobs] = useState(false);
  // Common upload state
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isUploaded, setIsUploaded] = useState<boolean>(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);

  // Handle switch between local/blob
  const handleUploadModeChange = (val: 'local' | 'blob') => {
    setUploadMode(val);
    setUploadStatus('');
    setIsUploaded(false);
    setUploadedFiles([]);
    setSelectedFiles([]);
    setSelectedBlobFiles([]);
    if (val === 'blob') {
      fetchBlobFiles();
    }
    console.log('uploadStatus is:', uploadStatus);
  };

  // Fetch blobs from backend
  const fetchBlobFiles = useCallback(async () => {
    setIsLoadingBlobs(true);
    setBlobFiles([]);
    setSelectedBlobFiles([]);
    try {
      const response = await axios.get(`${BASE_URL}/loadfiles`);
      setBlobFiles(response.data.files || response.data || []);
    } catch (err) {
      setBlobFiles([]);
    }
    setIsLoadingBlobs(false);
  }, []);

  // Local file input handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(Array.from(e.target.files));
      setUploadStatus('');
      setIsUploaded(false);
    }
  };

  // Blob file selection handler
  const handleBlobSelect = (blob: string) => {
    setSelectedBlobFiles(prev =>
      prev.includes(blob) ? prev.filter(f => f !== blob) : [...prev, blob]
    );
  };

  // Upload handler for both modes
  const handleUpload = async () => {
    setIsUploading(true);
    setUploadStatus(uploadMode === 'local' ? 'Uploading...' : 'Loading from blob...');
    setIsUploaded(false);
    setUploadedFiles([]);
    try {
      if (uploadMode === 'local') {
        if (!selectedFiles.length) return;
        const formData = new FormData();
        formData.append('indexName', 'default');
        selectedFiles.forEach(file => {
          formData.append('files', file);
        });
        const response = await axios.post(`${BASE_URL}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        setUploadStatus(response.data.status || 'Upload successful');
        setIsUploaded(response.data.status === 'success');
        setUploadedFiles(response.data.files || []);
        console.log('Blob upload response:', response.data.files);
        console.log('Selected files:', selectedFiles);
      } else {
        if (!selectedBlobFiles.length) return;
        // Use /uploadfromblob endpoint for blobs
        const response = await axios.post(`${BASE_URL}/uploadfromblob`, {
          files: selectedBlobFiles
        });
        setUploadStatus(response.data.status || 'Loaded from blob');
        setIsUploaded(response.data.status === 'success' || response.data.status === 'loaded');
        setUploadedFiles(response.data.files || []);
        console.log('Blob upload response:', response.data.files);
        console.log('Selected files:', selectedFiles);
        console.log('Selected blob files:', selectedBlobFiles);
      }
    } catch (error: any) {
      setUploadStatus('Upload failed');
      setIsUploaded(false);
      setUploadedFiles([]);
    }
    setIsUploading(false);
  };

  const [temperature, setTemperature] = useState<number>(0.5);
  const [diarization, setDiarization] = useState<boolean>(true);
  const [combine, setCombine] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isProcessed, setIsProcessed] = useState<boolean>(false);
  const [transcriptionResult, setTranscriptionResult] = useState<any>(null);
  const [allResults, setAllResults] = useState<any[]>([]); // <-- new state for all results
  const [groupedResults, setGroupedResults] = useState<Record<string, any[]>>({}); // <-- new state for grouped results
  const [language, setLanguage] = useState<string>('cs-CZ'); // new state for language
  // Add model selection state
  const [model, setModel] = useState<string>('llm');

  // Add new state for grouped speakers by filename
  const [groupedSpeakers, setGroupedSpeakers] = useState<Record<string, { speaker_id: string; speaker_name: string }[]>>({});
  // buffer for edits - now includes filename
  const [editNames, setEditNames] = useState<Record<string, Record<string, string>>>({});

  // Add a helper to build the grouped speaker list
  const populateGroupedSpeakers = (groupedResults: Record<string, any[]>) => {
    const speakers: Record<string, { speaker_id: string; speaker_name: string }[]> = {};
    
    Object.entries(groupedResults).forEach(([filename, results]) => {
      if (!results.length) return;
      const uniqueIds = Array.from(new Set(results.map(r => r.speaker_id)))
        .filter(id => id && id !== 'Unknown');
      speakers[filename] = uniqueIds.map(id => ({ speaker_id: id, speaker_name: id }));
    });
    
    setGroupedSpeakers(speakers);
  };

  // keep edit buffer in sync with grouped speakers
  useEffect(() => {
    const editBuffer: Record<string, Record<string, string>> = {};
    Object.entries(groupedSpeakers).forEach(([filename, speakers]) => {
      editBuffer[filename] = Object.fromEntries(
        speakers.map(s => [s.speaker_id, s.speaker_name])
      );
    });
    setEditNames(editBuffer);
  }, [groupedSpeakers]);

  // helper to get a speaker's display name
  const getSpeakerName = (speaker_id: string, filename?: string): string => {
    if (filename && groupedSpeakers[filename]) {
      const sp = groupedSpeakers[filename].find(s => s.speaker_id === speaker_id);
      return sp?.speaker_name || speaker_id;
    }
    // Fallback: search all files for the speaker
    for (const speakers of Object.values(groupedSpeakers)) {
      const sp = speakers.find(s => s.speaker_id === speaker_id);
      if (sp) return sp.speaker_name;
    }
    return speaker_id;
  }

  // Invoke helper when groupedResults changes
  useEffect(() => {
    populateGroupedSpeakers(groupedResults);
    console.log('groupedResults:', groupedResults);
    console.log('Grouped speakers:', groupedSpeakers);
  }, [groupedResults]);

  // Audio URLs for all selected files
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({});
  const [filenameMapping, setFilenameMapping] = useState<Record<string, string>>({});

  // create/revoke object URLs for all selectedFiles
  useEffect(() => {
    const urls: Record<string, string> = {};
    const mapping: Record<string, string> = {};
    
    selectedFiles.forEach(file => {
      urls[file.name] = URL.createObjectURL(file);
      
      // Create a mapping for potential filename transformations
      // Handle cases like .mp3 -> .wav conversion
      const baseName = file.name.replace(/\.(mp3|MP3)$/, '.wav');
      mapping[baseName] = file.name; // Map cleaned name to original name
      
      // Also add direct mapping
      mapping[file.name] = file.name;
    });
    
    setAudioUrls(urls);
    setFilenameMapping(mapping);
    
    // Set audioUrl for backward compatibility (first file)
    if (selectedFiles.length > 0) {
      setAudioUrl(urls[selectedFiles[0].name]);
    } else {
      setAudioUrl(null);
    }
    
    return () => {
      Object.values(urls).forEach(url => URL.revokeObjectURL(url));
    };
  }, [selectedFiles]);

  // cleanup any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
      // Clean up audio refs
      Object.values(audioRefs.current).forEach(audio => {
        audio.pause();
        audio.src = '';
      });
      audioRefs.current = {};
    }
  }, []);

  // Submit transcription handler
  const handleTranscriptionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Transcription parameters:', {
      temperature,
      diarization,
      combine,
      language,
    });

    if (!uploadedFiles.length) return;
    setIsProcessing(true);
    setIsProcessed(false);
    setTranscriptionResult(null);
    setAllResults([]); // reset before new processing
    setGroupedResults({}); // reset grouped results
    // Start timer
    const startTime = Date.now();

    try {
      let allResultsCombined: any[] = [];
      let groupedResults: Record<string, any[]> = {};

      // these values are not used in the backend, but we reset them to defaults
      setTemperature(0.5); // Reset temperature to default
      setDiarization(true); // Reset diarization to default
      setCombine(false); // Reset combine to default
      setLanguage('cs-CZ'); // Reset language to default

      for (const file of uploadedFiles) {
        const formData = new FormData();
        formData.append('file_name', file.filename); // file.filename is now the path or name
        formData.append('file_name_original', file.filename_original); // keep original name for display
        formData.append('temperature', temperature.toString());
        formData.append('diarization', diarization ? 'true' : 'false');
        formData.append('combine', combine ? 'true' : 'false');
        formData.append('language', language);
        formData.append('model', model);
        formData.append('user_id', userInfo.email); // Add user email as user_id
        formData.append('session_id', userInfo.sessionId); // Add session_id from user context

        console.log('Session ID:', userInfo.sessionId);
        console.log('User ID:', userInfo.email);

        const response = await fetch(`${BASE_URL}/submit`, {
          method: 'POST',
          body: formData,
        });

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let results: any[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.slice(5).trim();
              if (jsonStr) {
                try {
                  const data = JSON.parse(jsonStr);
                  // setSessionID(data.session);

                  // Extract just the filename from the full path (remove ./data/upload_ prefix)
                  let cleanFilename = data.filename;
                  if (cleanFilename && cleanFilename.includes('/')) {
                    cleanFilename = cleanFilename.split('/').pop();
                  }
                  // if (cleanFilename && cleanFilename.startsWith('upload_')) {
                  //   cleanFilename = cleanFilename.substring(7);
                  // }

                  const resultItem = {
                    filename: cleanFilename || file.filename,
                    originalPath: data.filename,
                    status: data.event_type,
                    session: data.session,
                    message: data.text,
                    ...data
                  };
                  results.push(resultItem);

                  // Group results by cleaned filename
                  const filename = cleanFilename || file.filename;
                  if (!groupedResults[filename]) {
                    groupedResults[filename] = [];
                  }
                  groupedResults[filename].push(resultItem);

                  setTranscriptionResult({
                    filename: data.filename,
                    status: data.event_type,
                    message: data.text,
                    session: data.session,
                    ...data
                  });
                  setAllResults([...allResultsCombined, ...results]);
                } catch (err) {
                  // ignore parse errors for incomplete chunks
                }
              }
            }
          }
        }
        allResultsCombined = [...allResultsCombined, ...results];
      }
      console.log('transcriptionResult:', transcriptionResult);
      console.log('All results combined:', allResultsCombined);
      console.log('Grouped results by filename:', groupedResults);

      // Measure elapsed time and set sessionTime (assumes sessionTime state exists)
      const elapsedTime = Date.now() - startTime;
      const minutes = Math.floor(elapsedTime / 60000);
      const seconds = Math.floor((elapsedTime % 60000) / 1000);
      setSessionTime(`${minutes}:${seconds < 10 ? '0' : ''}${seconds}`);
      setAllResults(allResultsCombined);
      setGroupedResults(groupedResults);
      setIsProcessed(true);
      setIsProcessing(false);

    } catch (error: any) {
      setTranscriptionResult({ status: 'error', message: error?.message || 'Unknown error' });
      setIsProcessed(true);
      setIsProcessing(false);
    }
  };

  // Audio playback state
  const [audioUrl, setAudioUrl] = useState<string|null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const playbackTimeoutRef = useRef<number|null>(null);
  const [playingIdx, setPlayingIdx] = useState<number|null>(null);
  const [currentPlayingFile, setCurrentPlayingFile] = useState<string|null>(null);

  // Helper function to get the correct audio element for a filename
  const getAudioElementForFile = (filename: string): HTMLAudioElement | null => {
    // Check if we have an audio element for this specific file
    if (audioRefs.current[filename]) {
      return audioRefs.current[filename];
    }
    
    // Try to find the original filename through mapping
    const originalFilename = filenameMapping[filename] || filename;
    
    // Check if we have a URL for the original filename
    if (audioUrls[originalFilename]) {
      const audioElement = new Audio(audioUrls[originalFilename]);
      audioRefs.current[filename] = audioElement; // Cache using the cleaned filename
      return audioElement;
    }
    
    // Try direct lookup in audioUrls
    if (audioUrls[filename]) {
      const audioElement = new Audio(audioUrls[filename]);
      audioRefs.current[filename] = audioElement;
      return audioElement;
    }
    
    // Fallback to the main audio ref (for backward compatibility)
    return audioRef.current;
  };

  // Helper function to stop all audio playback
  const stopAllAudio = () => {
    // Stop main audio ref
    if (audioRef.current) {
      audioRef.current.pause();
    }
    
    // Stop all file-specific audio refs
    Object.values(audioRefs.current).forEach(audio => {
      audio.pause();
    });
    
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
    }
    
    setPlayingIdx(null);
    setCurrentPlayingFile(null);
  };

  // Step 4: Analyze transcript state
  const [analysisText, setAnalysisText] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string>("");
  // Step 4: Custom prompt logic
  const [useCustomPrompt, setUseCustomPrompt] = useState<boolean>(false);
  const [customPrompt, setCustomPrompt] = useState<string>("");

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAnalyzing(true);
    setAnalyzeError("");
    setAnalysisResult(null);

    try {
      const formData = new FormData();
      formData.append('transcript', analysisText);
      if (useCustomPrompt && customPrompt.trim()) {
        formData.append('customPrompt', customPrompt);
      }

      const response = await fetch(`${BASE_URL}/analyze`, {
        method: 'POST',
        body: formData,
      });

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let lastText = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // console.log('Received chunk:', chunk);
        const lines = chunk.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            // console.log('Parsed JSON:', jsonStr);
            if (jsonStr) {
              try {
                const data = JSON.parse(jsonStr);
                // console.log('Parsed data:', data);
                if (data?.data?.text) {
                  lastText = data.data.text;
                  setAnalysisResult(lastText); // update as you go
                  console.log('Analysis result updated:', lastText);
                }
              } catch (err) {
                // ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (err: any) {
      setAnalyzeError("Analysis failed: " + (err?.message || "Unknown error"));
    }
    setIsAnalyzing(false);
  };



  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      {/* Main content */}
      {/* Authentication check removed, always render main content */}
      <SidebarProvider defaultOpen={true}>
        <AppSidebar /> {/* Remove onUserNameChange prop */}
        <SidebarInset>
          <header className="flex sticky top-0 bg-background h-10 shrink-0 items-center gap-2 border-b px-4 z-10 shadow">
            <div className="flex items-center gap-2 px-4 w-full">
              {/* <img src={banner} alt="Banner" className="h-64" /> */}
              <SidebarTrigger className="-ml-1" />
              {/* <Bot className="h-8 w-8" /> */}
              {/* <img src={appLogo  } alt="Banner" className="h-8" /> */}
              
              <Separator orientation="vertical" className="mr-2 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href="#">
                      App
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>Playground</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto hidden items-center gap-2 md:flex">
              <div className="text-xs text-muted-foreground">
                {userInfo.sessionId }
              </div>
              <Separator orientation="vertical" className="h-4" />
              <ModeToggle />
              </div>
            </div>
          </header>
          {/* Main content */}
         

          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <Separator  />
            {/* Agents setup */}
            {/* if session is running display loader */}
            <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min">
              
              {/* Transcription Mode Selection */}
              <Card className="md:col-span-2 flex flex-col">
                <CardHeader className="py-2">
                  <h2 className="text-lg font-semibold mb-4">Step 1. Choose transcription method</h2>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="flex gap-4 items-center mb-4">
                    <Label className="mr-2">Method:</Label>
                    <Select value={transcriptionMode} onValueChange={(val) => handleTranscriptionModeChange(val as 'record' | 'live')}>
                      <SelectTrigger className="w-60">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="record">📁 Record & Transcribe (Upload files)</SelectItem>
                        <SelectItem value="live">🎤 Live Transcription (Real-time)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {transcriptionMode === 'record' 
                      ? 'Upload existing audio files and process them with AI transcription'
                      : 'Real-time speech-to-text from your microphone with speaker diarization'
                    }
                  </p>
                </CardContent>
              </Card>

              {/* Upload files - only for record mode */}
              {transcriptionMode === 'record' && (
              <Card className="md:col-span-2 flex flex-col">
                <CardHeader className="py-2">
                  <h2 className="text-lg font-semibold mb-4">Step 2. Upload and transcribe recording</h2>
                </CardHeader>
                {!false && (
                <CardContent className="flex-1 h-96">
                  <Separator className='my-2 invisible'/>
                  {/* Upload mode switch */}
                  <div className="mb-4 flex gap-4 items-center">
                    <Label className="mr-2">Source:</Label>
                    <Select value={uploadMode} onValueChange={val => handleUploadModeChange(val as 'local' | 'blob')}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">Local File System</SelectItem>
                        <SelectItem value="blob">Blob Storage</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Local file upload UI */}
                  {uploadMode === 'local' && (
                    <div className="mb-4">
                      <label className="block mb-2 text-sm font-medium">Upload audio file (.wav, .mp3):</label>
                      <Input
                        type="file"
                        accept=".wav,.mp3"
                        onChange={handleFileChange}
                        disabled={isUploading}
                        className="mb-2"
                        multiple={true}
                      />
                      <Button
                        onClick={handleUpload}
                        disabled={selectedFiles.length === 0 || isUploading}
                        variant="outline"
                      >
                        {isUploading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-1 inline h-4 w-4" />}
                        {isUploading ? 'Uploading...' : 'Upload'}
                      </Button>
                    </div>
                  )}
                  {/* Blob storage UI */}
                  {uploadMode === 'blob' && (
                    <div className="mb-4">
                      <label className="block mb-2 text-sm font-medium">Select files from Blob Storage:</label>
                      {isLoadingBlobs ? (
                        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading blobs...</div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto border rounded p-2 mb-2 bg-muted/30">
                          {blobFiles.length === 0 ? (
                            <div className="text-xs text-muted-foreground">No blobs found.</div>
                          ) : (
                            blobFiles.map(blob => (
                              <div key={blob} className="flex items-center gap-2 py-1">
                                <input
                                  type="checkbox"
                                  checked={selectedBlobFiles.includes(blob)}
                                  onChange={() => handleBlobSelect(blob)}
                                  id={`blob-${blob}`}
                                  className="accent-blue-500"
                                />
                                <label htmlFor={`blob-${blob}`} className="text-xs font-mono break-all cursor-pointer">{blob}</label>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      <Button
                        onClick={handleUpload}
                        disabled={selectedBlobFiles.length === 0 || isUploading}
                        variant="outline"
                      >
                        {isUploading ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <DownloadCloud className="mr-1 inline h-4 w-4" />}
                        {isUploading ? 'Loading...' : 'Load Selected'}
                      </Button>
                    </div>
                  )}

                  {/* Transcription settings - only show when files are uploaded */}
                  {isUploaded && (
                    <div className="px-6 pb-4">
                      <Separator className="mb-4" />
                      <h3 className="text-md font-semibold mb-4">Transcription Settings</h3>
                      
                      {/* Uploaded file info */}
                      {uploadedFiles.length > 0 && (
                        <div className="mb-6">
                          <div className="text-xs text-muted-foreground mb-2 font-semibold">Uploaded file details:</div>
                          <div className="space-y-2">
                            {uploadedFiles.map((file, idx) => (
                              <div
                                key={file.filename + idx}
                                className="rounded bg-muted/40 p-3 border border-muted-foreground/10 flex flex-col items-center"
                              >
                                <div className="flex items-center gap-4 w-full justify-center">
                                  <AudioLines className="h-8 w-8 text-blue-500" />
                                  <div className="font-mono text-sm text-foreground break-all">{file.filename_original}
                                    <Separator className="my-1"/>
                                    <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground justify-center">
                                      <div>Channels: <span className="font-semibold text-foreground">{file.inspect.channels}</span></div>
                                      <div>Bits/Sample: <span className="font-semibold text-foreground">{file.inspect.bits_per_sample}</span></div>
                                      <div>Sample/Frame Rate: <span className="font-semibold text-foreground">{file.inspect.samples_per_second || file.inspect.frame_rate} Hz</span></div>
                                  </div>
                                  </div>
                                  {selectedFiles[idx] && (
                                    <audio
                                      controls
                                      src={URL.createObjectURL(selectedFiles[idx])}
                                      className="h-8"
                                      style={{ minWidth: 120 }}
                                    />
                                  )}
                                </div>
                               
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <form className="space-y-6" onSubmit={handleTranscriptionSubmit}>
                        {/* Model selection */}
                        <div>
                          <Label htmlFor="model" className="mb-2 block">Model selection:</Label>
                          <Select value={model} onValueChange={setModel}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select model" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="llm">LLM</SelectItem>
                              <SelectItem value="whisper">Whisper</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {/* Submit button */}
                        <div>
                          <Button type="submit" variant="default" disabled={isProcessing} className="w-full">
                            {isProcessing ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <AudioLines className="mr-1 inline h-4 w-4" />}
                            {isProcessing ? 'Processing...' : 'Start Transcription'}
                          </Button>
                        </div>
                      </form>
                    </div>
                  )}
                </CardContent>
                )}
                {isProcessed && transcriptionMode === 'record' && (
                <CardFooter className="flex flex-col space-y-2">
                  <Check className="h-6 w-6 text-green-500" />
                  <span className="text-sm text-muted-foreground">Transcription completed successfully!</span>
                </CardFooter>
                )}
              </Card>
              )}

              {/* Live Recording - only for live mode */}
              {transcriptionMode === 'live' && (
              <Card className="md:col-span-2 flex flex-col">
                <CardHeader className="py-2">
                  <h2 className="text-lg font-semibold mb-4">Step 2. Live Recording</h2>
                </CardHeader>
                <CardContent>
                  <LiveRecordingSDKDiarization 
                    onTranscriptionStart={() => {
                      // Track session start time
                      setLiveSessionStartTime(Date.now());
                      console.log('Live session started');
                    }}
                    onTranscriptionUpdate={(results) => {
                      // Handle live transcription updates - convert to same format as batch
                      console.log('Live transcription update:', results);
                      
                      // Convert live results to same format as batch processing
                      const convertedResults = results.map(result => ({
                        filename: 'Live Session',
                        originalPath: 'live://session',
                        status: 'transcribed',
                        session: sessionID,
                        text: result.text, // Keep consistent with batch format
                        speaker_id: result.speaker,
                        offset: result.offset * 10000000, // Convert back to Azure format for consistency
                        duration: result.duration * 10000000,
                        timestamp: result.timestamp,
                        event_type: 'transcribed', // Add for consistency
                        confidence: result.confidence
                      }));
                      
                      // Add to allResults for unified processing
                      setAllResults(prev => [...prev, ...convertedResults]);
                      
                      // Update grouped results
                      setGroupedResults(prev => ({
                        ...prev,
                        'Live Session': [...(prev['Live Session'] || []), ...convertedResults]
                      }));
                    }}
                    onSessionEnd={(fullTranscription) => {
                      // Handle session end - same as batch processing
                      console.log('Live session ended, full transcription:', fullTranscription);
                      setIsProcessed(true);
                      
                      // Measure session time using actual start time
                      if (liveSessionStartTime) {
                        const elapsedTime = Date.now() - liveSessionStartTime;
                        const minutes = Math.floor(elapsedTime / 60000);
                        const seconds = Math.floor((elapsedTime % 60000) / 1000);
                        setSessionTime(`${minutes}:${seconds < 10 ? '0' : ''}${seconds}`);
                      }
                    }}
                  />
                </CardContent>
              </Card>
              )}

              <Separator className='my-2 invisible'/>

              {/* Live mode waiting info - only show when live mode and not processed */}
              {transcriptionMode === 'live' && !isProcessed && (
                <Card className="md:col-span-2 flex flex-col">
                  <CardContent className="py-6">
                    <div className="text-center py-8 text-muted-foreground">
                      <p className="text-sm">
                        Výsledky live transkripce se zobrazí ve Step 3 po ukončení nahrávání.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
              
              {/* Display all results after processing is done */}
              {isProcessed && allResults.length > 0 && (
                <Card className="md:col-span-2 flex flex-col mt-4">
                  <CardHeader className="py-6">
                    <h2 className="text-lg font-semibold mb-4">
                      {transcriptionMode === 'record' ? 'Step 3. Transcription Results' : 'Step 3. Live Session Results'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {transcriptionMode === 'record' ? `Session ID: ${sessionID} | ` : ''}
                      Elapsed Time: {sessionTime}
                      {transcriptionMode === 'live' ? ' | Real-time transcription' : ''}
                    </p>
                  </CardHeader>
                  <CardContent className="py-6">
                    {/* Speaker renaming UI removed from outside Tabs */}
                    
                    {/* Display results grouped by filename in Tabs, with speaker renaming in each tab */}
                    {Object.keys(groupedResults).length > 0 && (
                      <div className="mb-4">
                        <Tabs defaultValue={Object.keys(groupedResults)[0]} className="w-full">
                          <TabsList className="grid w-full grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
                            {Object.keys(groupedResults).map((filename) => (
                              <TabsTrigger key={filename} value={filename}>
                                {filename}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                          {Object.entries(groupedResults).map(([filename, results]) => (
                            <TabsContent key={filename} value={filename} className="w-full">
                              
                              {/* Speaker renaming UI for this file */}
                              <div className="flex items-start gap-3 mb-3 p-2 rounded bg-muted/40 ml-4">
                                <div className="flex flex-wrap gap-4 items-center">
                                  
                                  <span className="text-xs text-muted-foreground">Rename:</span>
                                  {groupedSpeakers[filename]?.map((sp) => (
                                    <div key={sp.speaker_id} className="flex items-center gap-2">
                                      {/* <span className="text-xs text-muted-foreground">{sp.speaker_id}:</span> */}
                                      <Input
                                        type="text"
                                        className="text-xs w-24 px-1 py-0.5 h-7"
                                        value={editNames[filename]?.[sp.speaker_id] || sp.speaker_name}
                                        onChange={e => {
                                          setEditNames(prev => ({
                                            ...prev,
                                            [filename]: {
                                              ...prev[filename],
                                              [sp.speaker_id]: e.currentTarget.value
                                            }
                                          }))
                                        }}
                                        onKeyDown={e => {
                                          if (e.key === 'Enter') {
                                            const newName = editNames[filename]?.[sp.speaker_id] || '';
                                            setGroupedSpeakers(prev => ({
                                              ...prev,
                                              [filename]: prev[filename]?.map(s =>
                                                s.speaker_id === sp.speaker_id
                                                  ? { ...s, speaker_name: newName }
                                                  : s
                                              ) || []
                                            }));
                                          }
                                        }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {/* Transcript segments for this file */}
                              {results
                                .filter(result => result.status === "transcribed" && (result.message || result.text))
                                .map((result, idx) => {
                                  const resultText = result.message || result.text; // Support both formats
                                  // Calculate global index for playback functionality
                                  const globalIdx = allResults.findIndex(r => 
                                    r.filename === result.filename && 
                                    (r.message === resultText || r.text === resultText) && 
                                    r.offset === result.offset
                                  );
                                  const SegmentIcon = (playingIdx === globalIdx && currentPlayingFile === filename) ? CirclePause : CirclePlay;

                                  return (
                                    <div
                                      key={`${filename}-${idx}`}
                                      className="flex items-start gap-3 mb-3 p-2 rounded bg-muted/40 ml-4"
                                    >
                                      <div className="flex flex-col items-center min-w-[40px]">
                                        <SegmentIcon
                                          onClick={() => {
                                            const audioElement = getAudioElementForFile(filename);
                                            if (!audioElement || typeof result.offset !== 'number') return;
                                            const startSec = result.offset / 1e7;
                                            // stop if clicking the same segment
                                            if (playingIdx === globalIdx && currentPlayingFile === filename) {
                                              stopAllAudio();
                                              return;
                                            }
                                            // stop any other playing audio first
                                            stopAllAudio();
                                            // start new segment
                                            const nextOff = allResults[globalIdx+1]?.offset;
                                            const endSec = nextOff ? nextOff/1e7 : audioElement.duration || 30; // fallback to 30s if duration unknown
                                            audioElement.currentTime = startSec;
                                            audioElement.play();
                                            setPlayingIdx(globalIdx);
                                            setCurrentPlayingFile(filename);
                                            if (endSec > startSec) {
                                              playbackTimeoutRef.current = window.setTimeout(() => {
                                                audioElement.pause();
                                                setPlayingIdx(null);
                                                setCurrentPlayingFile(null);
                                              }, (endSec - startSec) * 1000);
                                            }
                                          }}
                                          className="h-6 w-6 text-blue-500 cursor-pointer"
                                        />
                                        <span className="text-xs font-semibold text-muted-foreground">
                                          {getSpeakerName(result.speaker_id, filename)}
                                        </span>
                                        <span className="text-[10px] text-gray-400 mt-1">
                                          {typeof result.offset === "number"
                                            ? `${(result.offset / 10000000).toFixed(1)}s`
                                            : ""}
                                        </span>
                                      </div>
                                      <div className="flex-1">
                                        <span className="block text-sm text-foreground">
                                          {resultText}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })}
                            </TabsContent>
                          ))}
                        </Tabs>
                      </div>
                    )}
                    
                    
                  </CardContent>
                  <CardFooter className="flex flex-col space-y-2">
                    
                    {/* Download transcript button */}
                    <div className="mt-2 w-full flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          let text = '';
                          
                          // If we have grouped results, format by filename
                          if (Object.keys(groupedResults).length > 0) {
                            text = Object.entries(groupedResults)
                              .map(([filename, results]) => {
                                const transcriptedResults = results.filter(result => result.status === "transcribed" && (result.message || result.text));
                                if (transcriptedResults.length === 0) return '';
                                
                                const fileSection = `\n=== ${filename} ===\n\n` +
                                  transcriptedResults
                                    .map(result => `${getSpeakerName(result.speaker_id, filename)}: ${result.message || result.text}`)
                                    .join('\n');
                                return fileSection;
                              })
                              .filter(section => section !== '')
                              .join('\n\n');
                          } else {
                            // Fallback to original format
                            text = allResults
                              .filter(result => result.status === "transcribed" && (result.message || result.text))
                              .map(result =>
                                `${getSpeakerName(result.speaker_id)}: ${result.message || result.text}`
                              ).join('\n');
                          }
                          
                          const blob = new Blob([text], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `transcription_${transcriptionMode === 'live' ? 'live-session' : sessionID || 'results'}.txt`;
                          document.body.appendChild(a);
                          a.click();
                          setTimeout(() => {
                            document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                          }, 100);
                        }}
                        disabled={allResults.filter(result => result.status === "transcribed" && (result.message || result.text)).length === 0}
                      >
                        <DownloadCloud /> Download Transcript(s)
                      </Button>
                    </div>
                    <div className="relative w-full">
                      <p className="text-xs text-muted-foreground">
                        <Info className="mr-1 inline h-4 w-4" />
                          AI-generated content may be incorrect.
                      </p>
                    </div>
                  </CardFooter>
                </Card>

              )}

              {/* Step 4: Analyze transcript */}
              {isProcessed  && (
                <Card className="md:col-span-2 flex flex-col mt-4">
                  <CardHeader className="py-6">
                    <h2 className="text-lg font-semibold mb-4">
                      Step 4. Analyze {transcriptionMode === 'record' ? 'Transcript' : 'Live Session'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-2">
                      Paste or edit the {transcriptionMode === 'record' ? 'transcript' : 'live session results'} below, then click Analyze.
                    </p>
                  </CardHeader>
                  <CardContent className="py-6">
                    <form onSubmit={handleAnalyze} className="space-y-4">
                      {/* Custom prompt switch */}
                      <div className="flex items-center gap-2 mt-2">
                        <Switch id="custom-prompt-switch" checked={useCustomPrompt} onCheckedChange={setUseCustomPrompt} />
                        <Label htmlFor="custom-prompt-switch">Use custom prompt to analyze transcript</Label>
                      </div>
                      {useCustomPrompt && (
                        <textarea
                          className="w-full min-h-[260px] border rounded p-2 font-mono text-sm mt-2"
                          value={customPrompt}
                          onChange={e => setCustomPrompt(e.target.value)}
                          placeholder="Enter your custom prompt here..."
                          disabled={isAnalyzing}
                        />
                      )}
                      <textarea
                        className="w-full min-h-[120px] border rounded p-2 font-mono text-sm"
                        value={analysisText}
                        onChange={e => setAnalysisText(e.target.value)}
                        placeholder="Paste transcript here..."
                        disabled={isAnalyzing}
                      />
                      <Button type="submit" variant="default" disabled={isAnalyzing || !analysisText.trim()}>
                        {isAnalyzing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                        {isAnalyzing ? 'Analyzing...' : 'Analyze Transcript'}
                      </Button>
                    </form>
                    {/* Optionally, prefill transcript with joined results */}
                    {analysisText === "" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => {
                          let text = '';
                          // If we have grouped results, format by filename
                          if (Object.keys(groupedResults).length > 0) {
                            text = Object.entries(groupedResults)
                              .map(([filename, results]) => {
                                const transcriptedResults = results.filter(result => result.status === "transcribed" && (result.message || result.text));
                                if (transcriptedResults.length === 0) return '';
                                const fileSection = `=== ${filename} ===\n\n` +
                                  transcriptedResults
                                    .map(result => `${getSpeakerName(result.speaker_id, filename)}: ${result.message || result.text}`)
                                    .join('\n');
                                return fileSection;
                              })
                              .filter(section => section !== '')
                              .join('\n\n');
                          } else {
                            // Fallback to original format
                            text = allResults
                              .filter(result => result.status === "transcribed" && (result.message || result.text))
                              .map(result => `${getSpeakerName(result.speaker_id)}: ${result.message || result.text}`)
                              .join('\n');
                          }
                          setAnalysisText(text);
                        }}
                      >
                        Prefill with transcript
                      </Button>
                    )}
                    {analyzeError && (
                      <div className="mt-2 text-sm text-red-500">{analyzeError}</div>
                    )}
                    {analysisResult && (
                      <div className="mt-4 p-4 rounded bg-muted/40 border">
                        <h3 className="font-semibold mb-2">Analysis Result</h3>
                        <div className="text-sm message">
                          <MarkdownRenderer markdownText={analysisResult} />
                          {/* <AnalysisResultDisplay analysisResult={analysisResult} /> */}
                        </div>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-col space-y-2">
                    <div className="relative w-full">
                      <p className="text-xs text-muted-foreground">
                        <Info className="mr-1 inline h-4 w-4" />
                          AI-generated content may be incorrect.
                      </p>
                    </div>
                  </CardFooter>
                </Card>
              )}
              {isProcessing && (
                <Card className="md:col-span-2 flex flex-col mt-4">
                  <CardContent className="py-6">
                    <div className="text-sm flex items-center gap-2">
                      {/* <Loader2 className="h-8 w-8 animate-spin" /> */}
                      Transcribing, please wait...
                      <span className="ml-4 text-xs text-muted-foreground">Transcribed chunks: {allResults.length}</span>
                    </div>
                    {allResults
                      .filter(result => result.status === "transcribed" && result.message)
                      .map((result, idx) => {
                        return (
                          <div
                            key={idx}
                            className="flex items-start gap-3 mb-3 p-2 rounded bg-muted/40"
                          >
                            <div className="flex flex-col items-center min-w-[40px]">
                              <AudioLines />
                              <span className="text-xs font-semibold text-muted-foreground">
                                {getSpeakerName(result.speaker_id)}
                              </span>
                              <span className="text-[10px] text-gray-400 mt-1">
                                {typeof result.offset === "number"
                                  ? `${(result.offset / 10000000).toFixed(1)}s`
                                  : ""}
                              </span>
                            </div>
                            <div className="flex-1">
                              <span className="text-xs font-semibold text-muted-foreground">
                                {result.filename}
                              </span>
                              <Separator className="mx-2" orientation='vertical'/>
                              <span className="block text-sm text-foreground font-medium font-mono">
                                {result.message}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </CardContent>
                </Card>
              )}
              
            </div>
          </div>
          {/* hidden audio elements for playing segments */}
          <audio ref={audioRef} src={audioUrl ?? ''} hidden />
          {/* Additional audio elements for each file */}
          {Object.entries(audioUrls).map(([filename, url]) => (
            <audio 
              key={filename}
              ref={(el) => {
                if (el) {
                  audioRefs.current[filename] = el;
                  // Also create a reference using potential cleaned filename
                  const cleanedName = filename.replace(/\.(mp3|MP3)$/, '.wav');
                  if (cleanedName !== filename) {
                    audioRefs.current[cleanedName] = el;
                  }
                }
              }}
              src={url} 
              hidden 
            />
          ))}
          {/* Footer */}
          <Footer />
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  )};
