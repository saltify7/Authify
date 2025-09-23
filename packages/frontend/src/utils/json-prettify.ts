/**
 * JSON prettification utilities for HTTP request/response data
 */

/**
 * Validates if a string is valid JSON
 * @param str - The string to validate
 * @returns true if the string is valid JSON, false otherwise
 */
export const isValidJson = (str: string): boolean => {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
};

/**
 * Prettifies a JSON string with proper indentation
 * @param jsonStr - The JSON string to prettify
 * @returns The prettified JSON string, or the original string if parsing fails
 */
export const prettifyJson = (jsonStr: string): string => {
  try {
    const parsed = JSON.parse(jsonStr);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return jsonStr; // Return original if parsing fails
  }
};

/**
 * Prettifies JSON in HTTP request/response bodies
 * @param httpData - The raw HTTP data (headers + body)
 * @returns The HTTP data with prettified JSON body, or original data if no JSON body found
 */
export const prettifyHttpData = (httpData: string): string => {
  if (!httpData) return httpData;
  
  const lines = httpData.split('\n');
  let bodyStartIndex = -1;
  
  // Find where the body starts (after the empty line that separates headers from body)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim() === '') {
      bodyStartIndex = i + 1;
      break;
    }
  }
  
  // If no body found, return original data
  if (bodyStartIndex === -1 || bodyStartIndex >= lines.length) {
    return httpData;
  }
  
  // Extract body content
  const bodyLines = lines.slice(bodyStartIndex);
  const bodyText = bodyLines.join('\n').trim();
  
  // Check if the body is valid JSON
  if (bodyText && isValidJson(bodyText)) {
    // Prettify the JSON
    const prettifiedJson = prettifyJson(bodyText);
    
    // Replace the body section with prettified JSON
    const result = [
      ...lines.slice(0, bodyStartIndex),
      prettifiedJson
    ];
    
    return result.join('\n');
  }
  
  return httpData;
};
