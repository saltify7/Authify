
// Result type for safe error handling between backend and frontend
export type Result<T> =
  | { kind: "Error"; error: string }
  | { kind: "Ok"; value: T };


// Helper function to get proper content length from response
export const getResponseContentLength = (resp: any, respRaw: string): number => {
  // For responses without raw data, content length should be 0
  if (!respRaw) {
    return 0;
  }

  // First, try to get Content-Length from response headers (if response object is available)
  if (resp) {
    const responseHeaders = resp.getHeaders();
    for (const [headerName, headerValues] of Object.entries(responseHeaders)) {
      if (headerName.toLowerCase() === 'content-length' && Array.isArray(headerValues) && headerValues.length > 0 && headerValues[0]) {
        const headerLength = parseInt(headerValues[0], 10);
        if (!isNaN(headerLength)) {
          return headerLength;
        }
      }
    }
  }

  // If no Content-Length header, try to extract from raw response
  const contentLengthMatch = respRaw.match(/content-length:\s*(\d+)/i);
  if (contentLengthMatch && contentLengthMatch[1]) {
    const headerLength = parseInt(contentLengthMatch[1], 10);
    if (!isNaN(headerLength)) {
      return headerLength;
    }
  }

  // For responses without Content-Length header, calculate body length
  // Find the empty line that separates headers from body
  const lines = respRaw.split(/\r?\n/);
  let headerEndIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim() === '') {
      headerEndIndex = i;
      break;
    }
  }

  // If no separator found, assume no body
  if (headerEndIndex === -1) {
    return 0;
  }

  // Calculate body length (everything after the empty line)
  const bodyLines = lines.slice(headerEndIndex + 1);
  const body = bodyLines.join('\r\n');
  return body.length;
};

// Helper function to extract response body content
export const extractResponseBody = (responseRaw: string): string => {
  if (!responseRaw) return "";
  
  const lines = responseRaw.split(/\r?\n/);
  let bodyStartIndex = -1;
  
  // Find where the body starts (after the empty line that separates headers from body)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim() === '') {
      bodyStartIndex = i + 1;
      break;
    }
  }
  
  // If no body found, return empty string
  if (bodyStartIndex === -1 || bodyStartIndex >= lines.length) {
    return "";
  }
  
  // Extract body content
  const bodyLines = lines.slice(bodyStartIndex);
  return bodyLines.join('\r\n');
};

// Helper function to parse location header from response
export const getLocationHeader = (responseRaw: string): string | undefined => {
  if (!responseRaw) return undefined;
  
  const lines = responseRaw.split(/\r?\n/);
  
  // Look for Location header in the response headers
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    
    if (line.trim() === '') {
      // Reached the body, stop looking
      break;
    }
    
    const trimmedLine = line.trim();
    if (trimmedLine.toLowerCase().startsWith('location:')) {
      return trimmedLine.substring(9).trim(); // Remove "location:" prefix
    }
  }
  
  return undefined;
};

// Helper function to compare original and modified responses
export const compareResponses = (originalCode: number, originalLength: number, modifiedCode: number, modifiedLength: number, originalRespRaw: string, modifiedRespRaw: string): "same" | "different" | "similar" | "unknown" => {
  // Response codes different = different
  if (originalCode !== modifiedCode) {
    // Special case: if both are redirects (3xx) to the same location, consider them same
    if ((originalCode >= 300 && originalCode < 400) && (modifiedCode >= 300 && modifiedCode < 400)) {
      const originalLocation = getLocationHeader(originalRespRaw);
      const modifiedLocation = getLocationHeader(modifiedRespRaw);
      
      // If both are redirects to the same location, consider them same
      if (originalLocation && modifiedLocation && originalLocation === modifiedLocation) {
        return "same";
      }
    }
    return "different";
  }
  
  // Response codes are the same, now compare content
  const originalBody = extractResponseBody(originalRespRaw);
  const modifiedBody = extractResponseBody(modifiedRespRaw);
  
  // Strip whitespace for content comparison
  const originalContent = originalBody.replace(/\s+/g, ' ').trim();
  const modifiedContent = modifiedBody.replace(/\s+/g, ' ').trim();
  
  // Same length and same content (whitespace stripped) = same
  if (originalLength === modifiedLength && originalContent === modifiedContent) {
    return "same";
  }
  
  // Same length but different content = similar
  if (originalLength === modifiedLength && originalContent !== modifiedContent) {
    return "similar";
  }
  
  // Different length = different
  return "different";
};
