const axios = require('axios');
const fs = require('fs');
const path = require('path');

class OllamaService {
  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    this.model = process.env.OLLAMA_MODEL || 'llava:latest';
  }

  async processReceipt(imagePath) {
    try {
      console.log('Processing receipt with Ollama:', imagePath);

      // Read image as base64
      const imageBuffer = fs.readFileSync(imagePath);
      const imageBase64 = imageBuffer.toString('base64');

      const prompt = `Analyze this image and extract transaction details. This could be a receipt, payment confirmation, bank transfer, or any financial transaction. Return a JSON response with the following structure:
      {
        "amount": "numeric amount (e.g., 12.50)",
        "currency": "currency code (e.g., SGD)",
        "description": "brief description ONLY if clearly identifiable (null if unclear)",
        "merchant": "recipient/merchant/store name",
        "date": "transaction date in ISO format",
        "category": "category from: Food & Dining, Transportation, Shopping, Entertainment, Bills & Utilities, Healthcare, Education, Others",
        "payment_method": "detected payment method if visible: Cash, PayLah!, GrabPay, Credit Card, etc.",
        "confidence": "confidence score between 0.0 and 1.0"
      }

      CRITICAL ANALYSIS GUIDELINES:
      1. TRANSACTION TYPE IDENTIFICATION:
         - If you see "Transfer", "Send", "Sent to", "Payment to" → This is a money transfer, NOT a purchase
         - If you see store names, receipts, purchases → This is a purchase transaction
         - If you see bank/payment app interfaces → Analyze what type of transaction it is

      2. CATEGORIZATION RULES:
         - Money transfers to individuals → "Others" (unless clearly for a service)
         - Airport/travel related → "Transportation" 
         - Food purchases → "Food & Dining"
         - Shopping/retail → "Shopping"
         - Bills/utilities → "Bills & Utilities"

      3. DESCRIPTION GUIDELINES:
         - ONLY provide description if clearly identifiable from the image
         - For transfers: "Transfer to [recipient name]" or "Payment to [recipient]" (only if recipient visible)
         - For purchases: "[Item/service] at [merchant]" (only if specific items visible)
         - If unclear or generic receipt, set description to null

      4. MERCHANT/RECIPIENT:
         - For transfers: Use the recipient's name if visible
         - For purchases: Use the store/merchant name
         - If unclear, use "Unknown"

      5. CONFIDENCE SCORING:
         - High (0.8-1.0): Clear text, obvious transaction type, all details visible
         - Medium (0.5-0.7): Some text unclear but main details extractable
         - Low (0.1-0.4): Poor image quality or ambiguous transaction type

      6. SPECIAL CASES:
         - If image shows payment apps (PayNow, GrabPay, etc.), focus on the transaction details
         - If multiple amounts visible, use the final/total amount
         - If transaction is in foreign currency, note the original currency

      Return only valid JSON without any additional text or explanation.`;

      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt: prompt,
        images: [imageBase64],
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for more consistent results
          top_p: 0.9
        }
      }, {
        timeout: 60000, // 60 second timeout
        family: 4 // Force IPv4
      });

      if (!response.data || !response.data.response) {
        throw new Error('No response from Ollama');
      }

      const aiResponse = response.data.response.trim();
      console.log('Raw Ollama response:', aiResponse);

      // Try to parse JSON from the response
      let parsedResult;
      try {
        // Clean up response - remove any markdown code blocks
        const cleanedResponse = aiResponse
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .replace(/^\s*[\r\n]/gm, '')
          .trim();

        parsedResult = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        // Try to extract JSON using regex
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            parsedResult = JSON.parse(jsonMatch[0]);
          } catch (retryError) {
            throw new Error('Unable to parse AI response as JSON');
          }
        } else {
          throw new Error('No valid JSON found in AI response');
        }
      }

      // Validate required fields
      if (!parsedResult.amount) {
        throw new Error('AI response missing required field: amount');
      }

      // Normalize and validate the result
      const result = {
        amount: this.parseAmount(parsedResult.amount),
        currency: parsedResult.currency || 'SGD',
        description: parsedResult.description || null,
        merchant: parsedResult.merchant || 'Unknown',
        date: this.parseDate(parsedResult.date),
        category: this.validateCategory(parsedResult.category),
        payment_method: parsedResult.payment_method || null,
        confidence: this.validateConfidence(parsedResult.confidence)
      };

      console.log('Processed receipt result:', result);
      return result;

    } catch (error) {
      console.error('Ollama processing error:', error);

      // Return fallback result for partial processing
      return {
        amount: 0.01, // Small amount to indicate manual review needed
        currency: 'SGD',
        description: 'Receipt processing failed - please review manually',
        merchant: 'Unknown',
        date: new Date().toISOString(),
        category: 'Others',
        items: [],
        confidence: 0.1,
        error: error.message
      };
    }
  }

  parseAmount(amount) {
    if (typeof amount === 'number') return amount;
    if (typeof amount === 'string') {
      // Remove currency symbols and extract number
      const cleaned = amount.replace(/[^\d.-]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  parseDate(dateString) {
    if (!dateString) return new Date().toISOString();

    try {
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    } catch {
      return new Date().toISOString();
    }
  }

  validateCategory(category) {
    const validCategories = [
      'Food & Dining',
      'Transportation',
      'Shopping',
      'Entertainment',
      'Bills & Utilities',
      'Healthcare',
      'Education',
      'Others'
    ];

    if (validCategories.includes(category)) {
      return category;
    }

    // Try to map common categories
    const categoryMap = {
      'food': 'Food & Dining',
      'dining': 'Food & Dining',
      'restaurant': 'Food & Dining',
      'coffee': 'Food & Dining',
      'transport': 'Transportation',
      'taxi': 'Transportation',
      'bus': 'Transportation',
      'mrt': 'Transportation',
      'grab': 'Transportation',
      'retail': 'Shopping',
      'store': 'Shopping',
      'mall': 'Shopping',
      'supermarket': 'Shopping',
      'grocery': 'Shopping',
      'movie': 'Entertainment',
      'cinema': 'Entertainment',
      'game': 'Entertainment',
      'medical': 'Healthcare',
      'hospital': 'Healthcare',
      'clinic': 'Healthcare',
      'pharmacy': 'Healthcare',
      'school': 'Education',
      'course': 'Education',
      'book': 'Education'
    };

    const lowerCategory = (category || '').toLowerCase();
    for (const [key, value] of Object.entries(categoryMap)) {
      if (lowerCategory.includes(key)) {
        return value;
      }
    }

    return 'Others';
  }

  validateConfidence(confidence) {
    const parsed = parseFloat(confidence);
    if (isNaN(parsed)) return 0.5;
    return Math.max(0, Math.min(1, parsed)); // Clamp between 0 and 1
  }

  getTimeOfDay(dateString) {
    try {
      const date = new Date(dateString || new Date());
      const hour = date.getHours();

      if (hour >= 5 && hour < 12) return 'morning';
      if (hour >= 12 && hour < 17) return 'afternoon';
      if (hour >= 17 && hour < 21) return 'evening';
      return 'night';
    } catch {
      return 'unknown';
    }
  }

  async checkOllamaStatus() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/tags`, { timeout: 5000 });
      return {
        available: true,
        models: response.data.models || []
      };
    } catch (error) {
      console.error('Ollama not available:', error.message);
      return {
        available: false,
        error: error.message
      };
    }
  }

  async pullModel(modelName = this.model) {
    try {
      console.log(`Pulling Ollama model: ${modelName}`);

      const response = await axios.post(`${this.baseUrl}/api/pull`, {
        name: modelName
      }, {
        timeout: 300000 // 5 minute timeout for model pulling
      });

      return { success: true };
    } catch (error) {
      console.error(`Error pulling model ${modelName}:`, error);
      return { success: false, error: error.message };
    }
  }

  async processTextPrompt(prompt) {
    try {
      console.log('Processing text prompt with Ollama');

      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model, // Use the same model (llava can handle text-only)
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1,
          top_p: 0.9
        }
      }, {
        timeout: 30000,
        family: 4 // Force IPv4
      });

      if (!response.data || !response.data.response) {
        throw new Error('No response from Ollama');
      }

      const aiResponse = response.data.response.trim();
      console.log('Raw Ollama text response:', aiResponse);

      // Try to parse JSON from the response
      try {
        let cleanedResponse = aiResponse
          .replace(/```json\s*/g, '')
          .replace(/```\s*/g, '')
          .replace(/^\s*[\r\n]/gm, '')
          .trim();
        
        // Fix common JSON escaping issues from AI models
        cleanedResponse = cleanedResponse
          .replace(/\\_/g, '_')           // Fix escaped underscores
          .replace(/\\\//g, '/')          // Fix escaped slashes
          .replace(/\\"/g, '"')           // Fix escaped quotes
          .replace(/\\n/g, '\n')          // Fix escaped newlines
          .replace(/\\t/g, '\t');         // Fix escaped tabs

        console.log('Cleaned JSON before parsing:', cleanedResponse);
        return JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        // Try to extract JSON using regex
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            let cleanedJson = jsonMatch[0];
            // Apply same cleaning to retry attempt
            cleanedJson = cleanedJson
              .replace(/\\_/g, '_')           // Fix escaped underscores
              .replace(/\\\//g, '/')          // Fix escaped slashes
              .replace(/\\"/g, '"')           // Fix escaped quotes
              .replace(/\\n/g, '\n')          // Fix escaped newlines
              .replace(/\\t/g, '\t');         // Fix escaped tabs
            return JSON.parse(cleanedJson);
          } catch (retryError) {
            throw new Error('Unable to parse AI response as JSON');
          }
        } else {
          throw new Error('No valid JSON found in AI response');
        }
      }
    } catch (error) {
      console.error('Ollama text processing error:', error);
      throw error;
    }
  }

  async testModelWithSample() {
    try {
      // Create a test prompt without image
      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt: 'Respond with: {"test": "success", "confidence": 1.0}',
        stream: false
      }, {
        timeout: 30000
      });

      if (response.data && response.data.response) {
        try {
          const result = JSON.parse(response.data.response.trim());
          return { success: true, result };
        } catch {
          return { success: true, rawResponse: response.data.response };
        }
      }

      return { success: false, error: 'No response from model' };
    } catch (error) {
      console.error('Error testing model:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new OllamaService();