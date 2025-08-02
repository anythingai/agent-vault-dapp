const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Global test setup for infrastructure tests
beforeAll(() => {
  console.log('Setting up infrastructure test environment...');
  
  // Validate that we're in the correct directory structure
  const projectRoot = path.join(__dirname, '../..');
  const expectedDirs = [
    'infrastructure',
    'scripts',
    'docs'
  ];
  
  expectedDirs.forEach(dir => {
    const dirPath = path.join(projectRoot, dir);
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Expected directory not found: ${dirPath}`);
    }
  });
  
  console.log('Infrastructure test environment setup complete');
});

// Global test configuration
jest.setTimeout(300000); // 5 minutes for infrastructure tests

// Helper functions for tests
global.testHelpers = {
  // Execute command with timeout and error handling
  execCommand: (command, options = {}) => {
    const defaultOptions = {
      encoding: 'utf8',
      timeout: 30000,
      ...options
    };
    
    try {
      return execSync(command, defaultOptions);
    } catch (error) {
      if (options.allowFailure) {
        return { error: error.message, status: error.status };
      }
      throw error;
    }
  },

  // Check if a command exists
  commandExists: (command) => {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  },

  // Skip test if prerequisite is not met
  skipIfMissing: (command, testName) => {
    if (!global.testHelpers.commandExists(command)) {
      console.warn(`Skipping ${testName} - ${command} not available`);
      return true;
    }
    return false;
  },

  // Read and parse YAML file
  readYaml: (filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`YAML file not found: ${filePath}`);
    }
    
    const yaml = require('js-yaml');
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content);
  },

  // Validate file exists and is readable
  validateFile: (filePath, description = 'File') => {
    expect(fs.existsSync(filePath)).toBe(true);
    
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch (error) {
      fail(`${description} is not readable: ${filePath}`);
    }
  },

  // Generate temporary test files
  createTempFile: (content, extension = '.tmp') => {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempFile = path.join(tempDir, `test-${Date.now()}${extension}`);
    fs.writeFileSync(tempFile, content);
    
    // Schedule cleanup
    afterAll(() => {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    });
    
    return tempFile;
  }
};

// Clean up after all tests
afterAll(() => {
  console.log('Cleaning up infrastructure test environment...');
  
  // Clean up any temporary files
  const tempDir = path.join(__dirname, 'temp');
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  
  console.log('Infrastructure test cleanup complete');
});

// Handle uncaught exceptions in tests
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in infrastructure tests:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection in infrastructure tests:', reason);
  process.exit(1);
});