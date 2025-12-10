import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = 'claude-sonnet-4-5-20250929';

async function testChat() {
  console.log('Testing Anthropic API...');
  console.log('Model:', MODEL);
  console.log('API Key (first 20 chars):', process.env.ANTHROPIC_API_KEY?.substring(0, 20) + '...');

  try {
    const stream = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: 'Say hello in one sentence'
        }
      ],
      stream: true,
    });

    console.log('\nStream created successfully!');
    console.log('Receiving response...\n');

    let fullResponse = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const text = event.delta.text;
        fullResponse += text;
        process.stdout.write(text);
      }
    }

    console.log('\n\n✅ SUCCESS! Chat is working correctly.');
    console.log('Full response:', fullResponse);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Error name:', error.name);
    console.error('Error status:', error.status);
    console.error('Error type:', error.type);
    console.error('Full error:', JSON.stringify(error, null, 2));
  }
}

testChat();
