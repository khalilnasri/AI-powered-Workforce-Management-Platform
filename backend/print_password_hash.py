"""
Print a bcrypt hash for an employee row (paste into SQL as the password column).

Run from the backend folder:
  python print_password_hash.py your_plain_password
"""

import sys

from app.auth.passwords import hash_password


def main() -> None:
    pw = sys.argv[1] if len(sys.argv) > 1 else "changeme"
    print(hash_password(pw))


if __name__ == "__main__":
    main()
