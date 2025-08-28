#!/usr/bin/env python3
"""
Receipt Processing Service using EasyOCR
Converts receipt images to structured text for better AI understanding
"""

import sys
import json
import os
from pathlib import Path

try:
    import easyocr
except ImportError as e:
    print(json.dumps({"error": f"Missing EasyOCR: {e}"}))
    sys.exit(1)

def process_receipt_image(image_path):
    """
    Process a receipt image using EasyOCR
    Returns structured text data
    """
    try:
        print(f"Processing image with EasyOCR: {image_path}", file=sys.stderr)
        
        # Check if file exists and is readable
        if not os.path.exists(image_path):
            return {"error": f"Image file not found: {image_path}"}
        
        # Initialize EasyOCR reader
        reader = easyocr.Reader(['en'], gpu=False)  # Force CPU to avoid GPU issues
        
        # Extract text from image
        ocr_results = reader.readtext(image_path)
        
        if not ocr_results:
            return {"error": "No text detected in image"}
        
        # Filter results by confidence and extract text
        high_confidence_text = []
        all_text = []
        
        for result in ocr_results:
            bbox, text, confidence = result
            all_text.append(f"{text} (conf: {confidence:.2f})")
            
            # Only include high confidence text in main extraction
            if confidence > 0.5:
                high_confidence_text.append(text)
        
        if not high_confidence_text:
            return {"error": "No high-confidence text detected in image"}
        
        # Join text with newlines to preserve structure
        extracted_text = "\n".join(high_confidence_text)
        
        print(f"EasyOCR extracted {len(extracted_text)} characters from {len(high_confidence_text)} text regions", file=sys.stderr)
        
        return {
            "raw_text": extracted_text,
            "processed_text": clean_receipt_text(extracted_text),
            "extraction_method": "easyocr",
            "confidence_details": all_text,
            "success": True
        }
        
    except Exception as e:
        print(f"EasyOCR processing failed: {e}", file=sys.stderr)
        return {"error": f"OCR processing failed: {str(e)}"}

def clean_receipt_text(text):
    """
    Clean and structure the extracted text for better AI processing
    """
    if not text:
        return "No text extracted"
    
    lines = text.strip().split('\n')
    cleaned_lines = []
    
    for line in lines:
        line = line.strip()
        # Skip empty lines, single characters, and common OCR noise
        if line and len(line) > 1 and not line.isspace():
            # Remove excessive whitespace
            line = ' '.join(line.split())
            # Skip lines that are just symbols or numbers without context
            if not line.replace('-', '').replace('_', '').replace('*', '').strip():
                continue
            cleaned_lines.append(line)
    
    if not cleaned_lines:
        return "No meaningful text extracted from receipt"
    
    # Structure the text with clear sections
    structured_text = "RECEIPT CONTENT:\n"
    structured_text += "=" * 40 + "\n"
    
    # Group lines that might be related
    for i, line in enumerate(cleaned_lines):
        structured_text += f"{line}\n"
        
        # Add spacing between different sections (heuristic)
        if i < len(cleaned_lines) - 1:
            current_line = line.lower()
            next_line = cleaned_lines[i + 1].lower()
            
            # Add spacing after store names, dates, totals
            if any(keyword in current_line for keyword in ['total', 'subtotal', 'tax', 'date', 'time']):
                structured_text += "\n"
    
    structured_text += "=" * 40 + "\n"
    structured_text += "END OF RECEIPT"
    
    return structured_text

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Usage: python receipt_processor.py <image_path>"}))
        sys.exit(1)
    
    image_path = sys.argv[1]
    
    if not os.path.exists(image_path):
        print(json.dumps({"error": f"Image file not found: {image_path}"}))
        sys.exit(1)
    
    result = process_receipt_image(image_path)
    print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()