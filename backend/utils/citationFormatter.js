/**
 * Citation Formatter Utility
 * Generates formatted citations in various styles (MLA, APA, Chicago, Harvard)
 */

// Format author names
function formatAuthors(authors, style, isInText = false) {
  if (!authors || authors.length === 0) return '';

  const authorArray = Array.isArray(authors) ? authors : [authors];

  if (style === 'MLA') {
    if (authorArray.length === 1) {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName}.`;
    } else if (authorArray.length === 2) {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName}, and ${authorArray[1].firstName} ${authorArray[1].lastName}.`;
    } else {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName}, et al.`;
    }
  } else if (style === 'APA') {
    if (authorArray.length === 1) {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName.charAt(0)}.`;
    } else if (authorArray.length <= 7) {
      const formattedAuthors = authorArray.map((author, index) => {
        if (index === authorArray.length - 1 && authorArray.length > 1) {
          return `& ${author.lastName}, ${author.firstName.charAt(0)}.`;
        }
        return `${author.lastName}, ${author.firstName.charAt(0)}.`;
      });
      return formattedAuthors.join(', ');
    } else {
      const firstSix = authorArray.slice(0, 6).map(a => `${a.lastName}, ${a.firstName.charAt(0)}.`);
      return `${firstSix.join(', ')}, ... ${authorArray[authorArray.length - 1].lastName}, ${authorArray[authorArray.length - 1].firstName.charAt(0)}.`;
    }
  } else if (style === 'Chicago') {
    if (authorArray.length === 1) {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName}.`;
    } else if (authorArray.length <= 3) {
      const formatted = authorArray.map((author, index) => {
        if (index === 0) return `${author.lastName}, ${author.firstName}`;
        if (index === authorArray.length - 1) return `and ${author.firstName} ${author.lastName}`;
        return `${author.firstName} ${author.lastName}`;
      });
      return formatted.join(', ') + '.';
    } else {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName}, et al.`;
    }
  } else if (style === 'Harvard') {
    if (authorArray.length === 1) {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName.charAt(0)}.`;
    } else if (authorArray.length <= 3) {
      const formatted = authorArray.map((author, index) => {
        if (index === authorArray.length - 1 && authorArray.length > 1) {
          return `and ${author.lastName}, ${author.firstName.charAt(0)}.`;
        }
        return `${author.lastName}, ${author.firstName.charAt(0)}.`;
      });
      return formatted.join(', ');
    } else {
      return `${authorArray[0].lastName}, ${authorArray[0].firstName.charAt(0)}. et al.`;
    }
  }

  return '';
}

// Format book citation
function formatBook(style, data) {
  const { authors, title, publisher, year, city, edition } = data;

  if (style === 'MLA') {
    let citation = formatAuthors(authors, 'MLA') + ' ';
    citation += `<em>${title}</em>. `;
    if (edition) citation += `${edition} ed. `;
    citation += `${publisher}, ${year}.`;
    return citation;
  } else if (style === 'APA') {
    let citation = formatAuthors(authors, 'APA') + ' ';
    citation += `(${year}). `;
    citation += `<em>${title}</em>`;
    if (edition) citation += ` (${edition} ed.)`;
    citation += `. ${publisher}.`;
    return citation;
  } else if (style === 'Chicago') {
    let citation = formatAuthors(authors, 'Chicago') + ' ';
    citation += `<em>${title}</em>. `;
    if (edition) citation += `${edition} ed. `;
    citation += `${city}: ${publisher}, ${year}.`;
    return citation;
  } else if (style === 'Harvard') {
    let citation = formatAuthors(authors, 'Harvard') + ' ';
    citation += `${year}. `;
    citation += `<em>${title}</em>`;
    if (edition) citation += `, ${edition} edn`;
    citation += `. ${city}: ${publisher}.`;
    return citation;
  }
}

// Format article citation
function formatArticle(style, data) {
  const { authors, title, journalName, volume, issue, pages, year, doi } = data;

  if (style === 'MLA') {
    let citation = formatAuthors(authors, 'MLA') + ' ';
    citation += `"${title}." `;
    citation += `<em>${journalName}</em>, `;
    if (volume) citation += `vol. ${volume}, `;
    if (issue) citation += `no. ${issue}, `;
    citation += `${year}, `;
    if (pages) citation += `pp. ${pages}. `;
    if (doi) citation += `doi:${doi}.`;
    return citation;
  } else if (style === 'APA') {
    let citation = formatAuthors(authors, 'APA') + ' ';
    citation += `(${year}). `;
    citation += `${title}. `;
    citation += `<em>${journalName}</em>, `;
    if (volume) citation += `<em>${volume}</em>`;
    if (issue) citation += `(${issue})`;
    if (pages) citation += `, ${pages}`;
    citation += '.';
    if (doi) citation += ` https://doi.org/${doi}`;
    return citation;
  } else if (style === 'Chicago') {
    let citation = formatAuthors(authors, 'Chicago') + ' ';
    citation += `"${title}." `;
    citation += `<em>${journalName}</em> `;
    if (volume) citation += `${volume}, `;
    if (issue) citation += `no. ${issue} `;
    citation += `(${year}): `;
    if (pages) citation += `${pages}.`;
    if (doi) citation += ` https://doi.org/${doi}.`;
    return citation;
  } else if (style === 'Harvard') {
    let citation = formatAuthors(authors, 'Harvard') + ' ';
    citation += `${year}. `;
    citation += `'${title}', `;
    citation += `<em>${journalName}</em>, `;
    if (volume) citation += `vol. ${volume}`;
    if (issue) citation += `, no. ${issue}`;
    if (pages) citation += `, pp. ${pages}`;
    citation += '.';
    return citation;
  }
}

// Format website citation
function formatWebsite(style, data) {
  const { authors, title, websiteName, url, accessDate, publishDate } = data;

  if (style === 'MLA') {
    let citation = '';
    if (authors && authors.length > 0) {
      citation += formatAuthors(authors, 'MLA') + ' ';
    }
    citation += `"${title}." `;
    if (websiteName) citation += `<em>${websiteName}</em>, `;
    if (publishDate) citation += `${publishDate}, `;
    citation += `${url}. `;
    if (accessDate) citation += `Accessed ${accessDate}.`;
    return citation;
  } else if (style === 'APA') {
    let citation = '';
    if (authors && authors.length > 0) {
      citation += formatAuthors(authors, 'APA') + ' ';
    }
    if (publishDate) {
      citation += `(${publishDate}). `;
    } else {
      citation += '(n.d.). ';
    }
    citation += `${title}. `;
    if (websiteName) citation += `${websiteName}. `;
    citation += `Retrieved from ${url}`;
    return citation;
  } else if (style === 'Chicago') {
    let citation = '';
    if (authors && authors.length > 0) {
      citation += formatAuthors(authors, 'Chicago') + ' ';
    }
    citation += `"${title}." `;
    if (websiteName) citation += `${websiteName}. `;
    if (publishDate) citation += `${publishDate}. `;
    citation += `${url}`;
    if (accessDate) citation += ` (accessed ${accessDate})`;
    citation += '.';
    return citation;
  } else if (style === 'Harvard') {
    let citation = '';
    if (authors && authors.length > 0) {
      citation += formatAuthors(authors, 'Harvard') + ' ';
    }
    if (publishDate) {
      citation += `${publishDate}. `;
    } else {
      citation += 'n.d. ';
    }
    citation += `${title}. `;
    if (websiteName) citation += `[${websiteName}] `;
    citation += `Available at: ${url}`;
    if (accessDate) citation += ` [Accessed ${accessDate}]`;
    citation += '.';
    return citation;
  }
}

// Format newspaper citation
function formatNewspaper(style, data) {
  const { authors, title, newspaperName, date, pages, url } = data;

  if (style === 'MLA') {
    let citation = formatAuthors(authors, 'MLA') + ' ';
    citation += `"${title}." `;
    citation += `<em>${newspaperName}</em>, `;
    citation += `${date}`;
    if (pages) citation += `, pp. ${pages}`;
    citation += '.';
    if (url) citation += ` ${url}.`;
    return citation;
  } else if (style === 'APA') {
    let citation = formatAuthors(authors, 'APA') + ' ';
    citation += `(${date}). `;
    citation += `${title}. `;
    citation += `<em>${newspaperName}</em>`;
    if (pages) citation += `, p. ${pages}`;
    citation += '.';
    if (url) citation += ` ${url}`;
    return citation;
  } else if (style === 'Chicago') {
    let citation = formatAuthors(authors, 'Chicago') + ' ';
    citation += `"${title}." `;
    citation += `<em>${newspaperName}</em>, `;
    citation += `${date}`;
    if (pages) citation += `, ${pages}`;
    citation += '.';
    return citation;
  } else if (style === 'Harvard') {
    let citation = formatAuthors(authors, 'Harvard') + ' ';
    citation += `${date}. `;
    citation += `'${title}', `;
    citation += `<em>${newspaperName}</em>`;
    if (pages) citation += `, p. ${pages}`;
    citation += '.';
    return citation;
  }
}

// Main function to generate citation
function generateCitation(citationType, citationStyle, sourceData) {
  switch (citationType) {
    case 'book':
      return formatBook(citationStyle, sourceData);
    case 'article':
    case 'journal':
      return formatArticle(citationStyle, sourceData);
    case 'website':
      return formatWebsite(citationStyle, sourceData);
    case 'newspaper':
      return formatNewspaper(citationStyle, sourceData);
    case 'video':
    case 'podcast':
      // Can be extended for video/podcast citations
      return formatWebsite(citationStyle, sourceData);
    default:
      throw new Error(`Unsupported citation type: ${citationType}`);
  }
}

export { generateCitation, formatAuthors };
