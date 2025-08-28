const OllamaService = require('./src/services/OllamaService');

async function testOllama() {
  console.log('🧪 Testing Ollama service...');
  
  try {
    // Check if Ollama is available
    const status = await OllamaService.checkOllamaStatus();
    console.log('Ollama status:', status);
    
    if (!status.available) {
      console.log('❌ Ollama is not available');
      return;
    }
    
    // Test model with simple prompt
    console.log('\n🤖 Testing model with simple prompt...');
    const testResult = await OllamaService.testModelWithSample();
    console.log('Test result:', testResult);
    
    console.log('\n✅ Ollama service test completed');
    
  } catch (error) {
    console.error('❌ Error testing Ollama:', error);
  }
}

testOllama();