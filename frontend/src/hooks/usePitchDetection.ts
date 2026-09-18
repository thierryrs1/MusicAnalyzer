import { useState, useEffect, useRef } from 'react';
import { YIN } from 'pitchfinder';

export function usePitchDetection() {
  const [pitch, setPitch] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const microphoneRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new window.AudioContext();
      audioContextRef.current = audioContext;
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;
      
      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyser);
      microphoneRef.current = microphone;
      
      const detectPitch = YIN({ sampleRate: audioContext.sampleRate });
      const dataArray = new Float32Array(analyser.fftSize);
      
      const updatePitch = () => {
        analyser.getFloatTimeDomainData(dataArray);
        const freq = detectPitch(dataArray);
        
        if (freq) {
          // Convert frequency to MIDI pitch
          const midiPitch = Math.round(12 * (Math.log2(freq / 440)) + 69);
          setPitch(midiPitch);
        } else {
          setPitch(null);
        }
        
        rafIdRef.current = requestAnimationFrame(updatePitch);
      };
      
      updatePitch();
      setIsRecording(true);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
    }
  };
  
  const stopRecording = () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setPitch(null);
    setIsRecording(false);
  };
  
  useEffect(() => {
    return () => stopRecording();
  }, []);
  
  return { pitch, isRecording, startRecording, stopRecording };
}
