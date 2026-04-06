import os

def check_for_nulls(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.py'):
                path = os.path.join(root, file)
                try:
                    with open(path, 'rb') as f:
                        content = f.read()
                        if b'\x00' in content:
                            print(f"FOUND NUL: {path}")
                            # Print the index of the first NUL
                            print(f"  First NUL at offset: {content.index(b'\x00')}")
                        else:
                            print(f"CLEAN: {path}")
                except Exception as e:
                    print(f"ERROR reading {path}: {e}")

if __name__ == "__main__":
    check_for_nulls(r"c:\Users\danse\APPS\b-spline-generator-web-addin\frame-builder\engine")
