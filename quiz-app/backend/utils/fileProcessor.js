import mammoth from 'mammoth';
import fs from 'fs/promises';

export async function processFile(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();

  try {
    switch (ext) {
      case 'pdf':
        throw new Error('PDF files are not supported yet. Please upload a TXT or DOCX file instead.');
      case 'txt':
        return await processTXT(file.path);
      case 'docx':
      case 'doc':
        return await processDOCX(file.path);
      default:
        throw new Error('Unsupported file format. Please upload a TXT or DOCX file.');
    }
  } catch (error) {
    console.error('File processing error:', error);
    throw new Error(`Error processing file: ${error.message}`);
  }
}

export default processFile;

async function processTXT(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf-8');

    if (!text || text.trim().length === 0) {
      throw new Error('Text file appears to be empty');
    }

    return text;
  } catch (error) {
    console.error('TXT processing error:', error);
    throw new Error(`Failed to read text file: ${error.message}`);
  }
}

async function processDOCX(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });

    if (!result.value || result.value.trim().length === 0) {
      throw new Error('No text content found in DOCX file');
    }

    return result.value;
  } catch (error) {
    console.error('DOCX processing error:', error);
    throw new Error(`Failed to extract text from DOCX: ${error.message}`);
  }
}
