import { mockSpeechWav } from '../wav.mjs';

export class MockVoiceProvider {
  name = 'mock';
  async generate({ text }) {
    return mockSpeechWav(text);
  }
  async close() {}
}
