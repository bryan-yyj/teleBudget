const axios = require('axios');
const fs = require('fs');
const path = require('path');

class OllamaService {
  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'llava:latest';
  }

  async processReceipt(imagePath) {
    try {
      console.log('Processing receipt with Ollama:', imagePath);
      
      // Read image as base64
      const imageBuffer = fs.readFileSync(imagePath);
      const imageBase64 = imageBuffer.toString('base64');
      
      const prompt = `Analyze this receipt image and extract transaction details. Return a JSON response with the following structure:
      {
        "amount": "numeric amount (e.g., 12.50)",
        "currency": "currency code (e.g., SGD)",
        "description": "brief description of the purchase",
        "merchant": "store/merchant name",
        "date": "transaction date in ISO format",
        "category": "category from: Food & Dining, Transportation, Shopping, Entertainment, Bills & Utilities, Healthcare, Education, Others",
        "items": ["list of purchased items"],
        "confidence": "confidence score between 0.0 and 1.0"
      }

      Important guidelines:
      - For Singapore receipts, currency is typically SGD
      - Extract the total amount including GST/tax
      - Use merchant name from receipt header
      - Choose the most appropriate category
      - If date is unclear, use current date
      - Set confidence based on text clarity and completeness
      - Include itemized purchases if visible

      Return only valid JSON without any additional text.`;

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
        timeout: 60000 // 60 second timeout
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
      if (!parsedResult.amount || !parsedResult.description) {
        throw new Error('AI response missing required fields (amount, description)');
      }

      // Normalize and validate the result
      const result = {
        amount: this.parseAmount(parsedResult.amount),
        currency: parsedResult.currency || 'SGD',
        description: parsedResult.description || 'Receipt transaction',
        merchant: parsedResult.merchant || 'Unknown',
        date: this.parseDate(parsedResult.date),
        category: this.validateCategory(parsedResult.category),
        items: Array.isArray(parsedResult.items) ? parsedResult.items : [],
        confidence: this.validateConfidence(parsedResult.confidence)
      };

      console.log('Processed receipt result:', result);
      return result;

    } catch (error) {
      console.error('Ollama processing error:', error);
      
      // Return fallback result for partial processing
      return {
        amount: 0,
        currency: 'SGD',
        description: 'Failed to process receipt - please review manually',
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