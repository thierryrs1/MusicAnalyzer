import librosa
import numpy as np
import pretty_midi
import scipy.signal

def extract_midi(wav_path, midi_path):
    print("Loading audio...")
    y, sr = librosa.load(wav_path, sr=22050, duration=30)
    
    print("Detecting pitch...")
    f0 = librosa.yin(y, fmin=65.4, fmax=1046.5, sr=sr, frame_length=2048)
    
    print("Calculating RMS...")
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    if np.max(rms) > 0:
        rms = rms / np.max(rms)
        
    print("Converting to MIDI pitch...")
    f0 = np.where(f0 > 0, f0, 1.0)
    midi_pitches = librosa.hz_to_midi(f0)
    midi_pitches = np.round(midi_pitches).astype(int)
    
    min_len = min(len(midi_pitches), len(rms))
    midi_pitches = midi_pitches[:min_len]
    rms = rms[:min_len]
    
    midi_pitches[rms < 0.05] = 0
    midi_pitches = scipy.signal.medfilt(midi_pitches, kernel_size=5)
    
    print("Extracting notes...")
    notes = []
    current_pitch = 0
    start_frame = 0
    
    for i, pitch in enumerate(midi_pitches):
        if pitch != current_pitch:
            if current_pitch > 0:
                start_time = librosa.frames_to_time(start_frame, sr=sr, hop_length=512)
                end_time = librosa.frames_to_time(i, sr=sr, hop_length=512)
                if end_time - start_time >= 0.1:
                    notes.append({
                        "pitch": int(current_pitch),
                        "start": start_time,
                        "end": end_time,
                        "velocity": 100
                    })
            current_pitch = pitch
            start_frame = i
            
    print(f"Detected {len(notes)} notes.")
    
    pm = pretty_midi.PrettyMIDI()
    inst = pretty_midi.Instrument(program=52)
    for n in notes:
        note = pretty_midi.Note(
            velocity=n['velocity'],
            pitch=n['pitch'],
            start=n['start'],
            end=n['end']
        )
        inst.notes.append(note)
    pm.instruments.append(inst)
    pm.write(midi_path)
    print(f"Saved {midi_path}")

if __name__ == '__main__':
    extract_midi('separated/htdemucs_6s/The Unforgiven II - Metallica (youtube)/vocals.wav', 'vocals.mid')
