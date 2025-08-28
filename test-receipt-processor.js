require('dotenv').config();
const ReceiptProcessor = require('./src/services/ReceiptProcessor');

async function testReceiptProcessor() {
  console.log('🧪 Testing Receipt Processor with EasyOCR...');
  
  const processor = new ReceiptProcessor();
  
  // You can test with any image file you have
  const testImagePath = process.argv[2];
  
  if (!testImagePath) {
    console.log('Usage: node test-receipt-processor.js <path-to-receipt-image>');
    console.log('Example: node test-receipt-processor.js ./test-receipt.jpg');
    return;
  }
  
  try {
    // Test the EasyOCR processor
    const result = await processor.testProcessor(testImagePath);
    
    if (result.success) {
      console.log('\n🎯 Creating AI Prompt...');
      const aiPrompt = processor.createAIPrompt(result);
      console.log('Prompt length:', aiPrompt.length);
      console.log('\nPrompt preview:');
      console.log(aiPrompt.substring(0, 400) + '...');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    // Check common issues
    if (error.message.includes('Missing EasyOCR')) {
      console.log('\n💡 Install EasyOCR:');
      console.log('pip install easyocr');
    }
    
    if (error.message.includes('not found')) {
      console.log('\n💡 Make sure the image file exists and is accessible');
    }
  }
}

testReceiptProcessor();