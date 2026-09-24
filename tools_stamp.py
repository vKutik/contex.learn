#!/usr/bin/env python3
"""Stamp a new build id into js/build.js and version.txt.

Run before committing a change to the app. The two files must agree: a
browser holding stale modules will have an old BUILD and see the mismatch.
"""
import subprocess, pathlib, datetime
root = pathlib.Path(__file__).parent
sha = subprocess.run(['git','rev-parse','--short','HEAD'], capture_output=True, text=True).stdout.strip()
bid = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M') + ('-' + sha if sha else '')
(root/'js'/'build.js').write_text(
  '/* build.js - the id of the deployed build. Written by tools_stamp.py;\n'
  '   do not edit by hand. See "Staying up to date" in the README. */\n'
  f"export const BUILD = '{bid}';\n")
(root/'version.txt').write_text(bid + '\n')
print('build', bid)
