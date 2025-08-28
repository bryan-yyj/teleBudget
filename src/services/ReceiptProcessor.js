const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class ReceiptProcessor {
  constructor() {
    this.pythonScript = path.join(__dirname, 'receipt_processor.py');
  }

  /**
   * Process a receipt image using EasyOCR
   * @param {string} imagePath - Path to the receipt image
   * @returns {Promise<Object>} Processed receipt data
   */
  async processReceiptImage(imagePath) {
    try {
      console.log('🔍 Processing receipt image with EasyOCR...');

      // Check if image file exists
      await fs.access(imagePath);

      // Run Python OCR processor
      const result = await this.runPythonProcessor(imagePath);

      if (result.error) {
        throw new Error(result.error);
      }

      console.log('✅ Receipt processed successfully with EasyOCR');
      console.log(`📄 Extracted ${result.processed_text?.length || 0} characters using ${result.extraction_method}`);

      return result;

    } catch (error) {
      console.error('❌ Receipt processing failed:', error.message);
      throw error;
    }
  }

  /**
   * Run the Python receipt processor
   * @param {string} imagePath - Path to image
   * @returns {Promise<Object>} Processing result
   */
  runPythonProcessor(imagePath) {
    return new Promise((resolve, reject) => {
      const python = spawn('python', [this.pythonScript, imagePath]);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      python.on('close', (code) => {
        if (stderr) {
          console.log('Python processor logs:', stderr);
        }

        if (code !== 0) {
          reject(new Error(`Python processor failed with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (parseError) {
          reject(new Error(`Failed to parse processor output: ${parseError.message}`));
        }
      });

      python.on('error', (error) => {
        reject(new Error(`Failed to start Python processor: ${error.message}`));
      });
    });
  }

  /**
   * Create a structured prompt for AI processing
   * @param {Object} processedData - Data from EasyOCR
   * @returns {string} Formatted prompt for AI
   */
  createAIPrompt(processedData) {
    const prompt = `
Please analyze this receipt/payment text extracted via OCR and extract transaction information in JSON format.

${processedData.processed_text}

Extract the following information:
- description: ONLY if clearly identifiable from the text (e.g., specific item names, service descriptions). If unclear or generic, leave as null or empty string.
- amount: Total amount (number only, no currency symbols)
- merchant: Store/business name or payment app (PayLah, GrabPay, etc.)
- category: Expense category (Food & Dining, Transportation, Shopping, Transfer, etc.)
- date: Transaction date if visible (YYYY-MM-DD format)
- payment_method: Payment method used (Cash, Card, PayLah, GrabPay, etc.)

IMPORTANT: Do NOT generate generic descriptions like "Receipt transaction" or "Purchase". Only include a description if you can identify specific items or services from the receipt text.

Return only valid JSON in this format:
{
  "description": null,
  "amount": 0.00,
  "merchant": "...",
  "category": "...",
  "date": "...",
  "payment_method": "...",
  "confidence": 0.9
}`;

    return prompt;
  }

  /**
   * Test the EasyOCR processor with a sample image
   * @param {string} imagePath - Path to test image
   */
  async testProcessor(imagePath) {
    try {
      console.log('🧪 Testing EasyOCR receipt processor...');
      const result = await this.processReceiptImage(imagePath);

      console.log('📊 OCR Results:');
      console.log('- Method:', result.extraction_method);
      console.log('- Success:', result.success);
      console.log('- Text length:', result.processed_text?.length || 0);
      console.log('- Confidence details:', result.confidence_details?.length || 0, 'text regions');

      if (result.processed_text) {
        console.log('\n📄 Extracted Text Preview:');
        console.log(result.processed_text.substring(0, 300) + '...');
      }

      return result;

    } catch (error) {
      console.error('❌ EasyOCR test failed:', error.message);
      throw error;
    }
  }
}

module.exports = ReceiptProcessor;