/**
 * Simple zero-dependency SEO auditor for compiled HTML output.
 */
export function auditSEO(html: string): string[] {
  const warnings: string[] = [];

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) {
    warnings.push("Missing <title> tag");
  } else if (!titleMatch[1]!.trim()) {
    warnings.push("<title> tag is empty");
  }

  const metaDescMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                        html.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (!metaDescMatch) {
    warnings.push("Missing <meta name=\"description\"> tag");
  } else if (!metaDescMatch[1]!.trim()) {
    warnings.push("<meta name=\"description\"> content is empty");
  }

  const canonicalMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i);
  if (!canonicalMatch) {
    warnings.push("Missing <link rel=\"canonical\"> tag");
  }

  const imgRegex = /<img\s+([^>]+)>/gi;
  let imgMatch;
  let imgIndex = 0;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    imgIndex++;
    const attrs = imgMatch[1];
    const altMatch = attrs!.match(/alt=["']([^"']*)["']/i);
    if (!altMatch) {
      const srcMatch = attrs!.match(/src=["']([^"']*)["']/i);
      const identifier = srcMatch ? `src="${srcMatch[1]!}"` : `image #${imgIndex}`;
      warnings.push(`Image missing alt attribute: ${identifier}`);
    }
  }

  return warnings;
}
