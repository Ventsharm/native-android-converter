"""Copy the three public frontend files into dist; never copy credentials/uploads."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
destination = root / 'dist'
destination.mkdir(exist_ok=True)
for name in ['index.html', 'builder.js', 'workflow.yml']:
    shutil.copyfile(root / name, destination / name)
print('Prepared index.html, builder.js and workflow.yml in dist/.')
