import random
bars = ''.join([f'<rect x="{i*2}" y="{50 - h/2}" width="1" height="{h}" rx="0.5" fill="#fff"/>' for i, h in enumerate([random.randint(10, 90) for _ in range(500)])])
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 100" preserveAspectRatio="none">{bars}</svg>'
with open('frontend/public/waveform.svg', 'w') as f:
    f.write(svg)
