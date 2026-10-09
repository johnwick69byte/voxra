#!/usr/bin/env python3
"""Validate Android manifest for forbidden permissions."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

FORBIDDEN_PERMISSIONS = {
    "android.permission.FOREGROUND_SERVICE_CAMERA",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE", 
    "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION",
}

REQUIRED_PERMISSIONS = {
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
}

def validate_manifest(manifest_path):
    """Check manifest for forbidden permissions."""
    errors = []
    
    if not manifest_path.exists():
        errors.append(f"Manifest not found: {manifest_path}")
        return False, errors
    
    try:
        tree = ET.parse(manifest_path)
        root = tree.getroot()
    except ET.ParseError as e:
        errors.append(f"Failed to parse manifest: {e}")
        return False, errors
    
    # Check all uses-permission elements
    ns = {'android': 'http://schemas.android.com/apk/res/android'}
    found_permissions = set()
    
    for perm in root.findall('.//{http://schemas.android.com/apk/res/android}uses-permission'):
        name = perm.get('{http://schemas.android.com/apk/res/android}name')
        if name:
            found_permissions.add(name)
            if name in FORBIDDEN_PERMISSIONS:
                errors.append(f"FORBIDDEN permission found: {name}")
    
    # Check required permissions
    for req in REQUIRED_PERMISSIONS:
        if req not in found_permissions:
            errors.append(f"REQUIRED permission missing: {req}")
    
    return len(errors) == 0, errors

if __name__ == "__main__":
    manifest_path = Path("android/app/src/main/AndroidManifest.xml")
    ok, errors = validate_manifest(manifest_path)
    
    if errors:
        print("MANIFEST VALIDATION FAILED:")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)
    else:
        print("Manifest validation passed")
        sys.exit(0)