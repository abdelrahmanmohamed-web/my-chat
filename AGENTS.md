# Arabic Formatting & Communication Guidelines

When communicating with the user in Arabic:

- **Right-to-Left (RTL) Layout**: Always ensure proper RTL formatting (wrap content in `<div dir="rtl">...</div>` to guarantee proper display).
- **English Terms & Identifiers**: Never mix English words directly into Arabic sentences without delimiters. Any English term, symbol, file name, or library name MUST be:
  1. Enclosed strictly inside parentheses, for example: `(Redis)` or `(server.ts)`.
  2. Or placed on a separate line or code block.
- **Natural Language Flow**: Keep Arabic sentences smooth, clear, and natural.

# Code & Mock Data Language Standards

- **English by Default**: All source code, code comments, docstrings, tests, error messages/codes in APIs, and mock/sample data MUST be written in English unless the user explicitly specifies otherwise.
