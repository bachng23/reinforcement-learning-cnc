"""Ensure an isolated engine cannot outlive a forcibly stopped HTTP owner."""
import os
import sys
import threading


def watch_parent(pid):
    if pid < 1:
        raise ValueError('Explicit HTTP owner PID required')
    def watch():
        if sys.platform == 'win32':
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            handle = kernel.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE only
            if not handle:
                os._exit(1)
            try:
                kernel.WaitForSingleObject(handle, 0xFFFFFFFF)
            finally:
                kernel.CloseHandle(handle)
            os._exit(1)
        else:
            while True:
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    os._exit(1)
                threading.Event().wait(.2)
    threading.Thread(target=watch, daemon=True, name='scenario-http-owner').start()
