from conftest import REPO


def test_dockerignore_lists_heavy_paths():
    ignored = (REPO / ".dockerignore").read_text().split()
    for entry in ("**/node_modules", "site/dist", ".git", "pipeline", "model"):
        assert entry in ignored
