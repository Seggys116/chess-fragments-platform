import ast
import hashlib
import re
from typing import Dict, List, Optional, Tuple
from worker import app


FORBIDDEN_IMPORTS = {
    'os', 'subprocess', 'socket', 'urllib', 'requests',
    'http', 'ftplib', 'telnetlib', 'smtplib', 'ssl',
    '__import__', 'eval', 'exec', 'compile', 'open',
    'sys', 'importlib', 'pkgutil', 'imp'
}

ALLOWED_STDLIB = {
    'random', 'time', 'math', 'itertools', 'functools',
    'collections', 'heapq', 'bisect', 'array', 'copy',
    'typing', 'dataclasses', 'enum', 'abc'
}

MAX_CODE_SIZE = 1073741824


def normalize_code(code: str) -> str:
    lines = []
    for line in code.split('\n'):
        line = re.sub(r'#.*$', '', line)
        line = line.strip()
        if line:
            lines.append(line)
    return '\n'.join(lines)


def compute_code_hash(code: str) -> str:
    normalized = normalize_code(code)
    return hashlib.sha256(normalized.encode()).hexdigest()


def extract_imports(code: str) -> List[str]:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return []

    imports = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name.split('.')[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imports.append(node.module.split('.')[0])

    return imports


def check_agent_function(code: str) -> bool:
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return False

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            if node.name == 'agent':
                args = node.args.args
                if len(args) >= 3:
                    arg_names = [arg.arg for arg in args[:3]]
                    if arg_names == ['board', 'player', 'var']:
                        return True

    return False


def check_dangerous_patterns(code: str) -> List[str]:
    """Check for dangerous code patterns"""
    dangerous = []

    patterns = [
        (r'\beval\s*\(', 'Use of eval()'),
        (r'\bexec\s*\(', 'Use of exec()'),
        (r'\bcompile\s*\(', 'Use of compile()'),
        (r'\b__import__\s*\(', 'Use of __import__()'),
        (r'\bopen\s*\(', 'Use of open()'),
        (r'\bfile\s*\(', 'Use of file()'),
        (r'\bgetattr\s*\(', 'Use of getattr()'),
        (r'\bsetattr\s*\(', 'Use of setattr()'),
        (r'\bdelattr\s*\(', 'Use of delattr()'),
        (r'\b__.*__\s*\(', 'Use of dunder methods'),
    ]

    for pattern, message in patterns:
        if re.search(pattern, code):
            dangerous.append(message)

    return dangerous


def validate_agent_code(code: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Validate agent code

    Returns:
        (is_valid, error_message, code_hash)
    """
    # Size check
    if len(code) > MAX_CODE_SIZE:
        return False, f"Code exceeds maximum size of {MAX_CODE_SIZE} bytes", None

    if len(code.strip()) < 10:
        return False, "Code is too short", None

    # Syntax check
    try:
        ast.parse(code)
    except SyntaxError as e:
        return False, f"Syntax error: {str(e)}", None

    # Check for agent function
    if not check_agent_function(code):
        return False, "Missing required 'agent(board, player, var)' function signature", None

    # Import validation
    imports = extract_imports(code)
    for imp in imports:
        if imp in FORBIDDEN_IMPORTS:
            return False, f"Forbidden import: {imp}", None

        if imp not in ALLOWED_STDLIB and not imp.startswith('chessmaker') and not imp.startswith('extension'):
            return False, f"Import '{imp}' not in allowed list", None

    # Dangerous pattern check
    dangerous = check_dangerous_patterns(code)
    if dangerous:
        return False, f"Dangerous code patterns detected: {', '.join(dangerous)}", None

    # Compute hash
    code_hash = compute_code_hash(code)

    return True, None, code_hash


@app.task(name='tasks.agent_validator.validate_new_agent')
def validate_new_agent(agent_id: str, code: str) -> Dict:
    """
    Task to validate a newly uploaded agent

    Returns:
        {
            'valid': bool,
            'error': Optional[str],
            'code_hash': Optional[str],
            'imports': List[str],
            'analysis': Dict
        }
    """
    is_valid, error, code_hash = validate_agent_code(code)

    if not is_valid:
        return {
            'valid': False,
            'error': error,
            'code_hash': None,
            'imports': [],
            'analysis': {}
        }

    imports = extract_imports(code)

    # TODO: Run quick test matches for initial analysis
    # For now, return basic validation
    analysis = {
        'code_size': len(code),
        'line_count': len(code.split('\n')),
        'import_count': len(imports),
        'validation_timestamp': 'now'
    }

    return {
        'valid': True,
        'error': None,
        'code_hash': code_hash,
        'imports': imports,
        'analysis': analysis
    }
