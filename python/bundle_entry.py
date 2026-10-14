"""Isolated Python entry point; allow only this package's sibling UI modules."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from easy_testing import main
main()
