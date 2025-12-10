import { supabase } from '../utils/supabaseClient.js';
import { generateCitation } from '../utils/citationFormatter.js';

// Generate a citation from source data
export async function generateCitationHandler(req, res) {
  try {
    const { citationType, citationStyle, sourceData } = req.body;
    const userId = req.user?.id;

    // Validate required fields
    if (!citationType || !citationStyle || !sourceData) {
      return res.status(400).json({
        error: 'Missing required fields: citationType, citationStyle, and sourceData are required'
      });
    }

    // Supported citation types
    const validTypes = ['book', 'article', 'website', 'journal', 'newspaper', 'video', 'podcast'];
    const validStyles = ['MLA', 'APA', 'Chicago', 'Harvard'];

    if (!validTypes.includes(citationType)) {
      return res.status(400).json({
        error: `Invalid citation type. Supported types: ${validTypes.join(', ')}`
      });
    }

    if (!validStyles.includes(citationStyle)) {
      return res.status(400).json({
        error: `Invalid citation style. Supported styles: ${validStyles.join(', ')}`
      });
    }

    // Generate the formatted citation
    const formattedCitation = generateCitation(citationType, citationStyle, sourceData);

    // If user is authenticated, save to database
    if (userId) {
      const { data, error } = await supabase
        .from('citations')
        .insert({
          user_id: userId,
          citation_type: citationType,
          citation_style: citationStyle,
          source_data: sourceData,
          formatted_citation: formattedCitation
        })
        .select()
        .single();

      if (error) {
        console.error('Error saving citation:', error);
        // Still return the citation even if save fails
        return res.json({
          citation: formattedCitation,
          saved: false,
          error: 'Citation generated but not saved'
        });
      }

      return res.json({
        citation: formattedCitation,
        saved: true,
        citationId: data.id,
        data: data
      });
    }

    // For unauthenticated users, just return the citation
    res.json({
      citation: formattedCitation,
      saved: false
    });

  } catch (error) {
    console.error('Error generating citation:', error);
    res.status(500).json({ error: 'Failed to generate citation' });
  }
}

// Get user's citation history
export async function getCitationHistory(req, res) {
  try {
    const userId = req.user.id;
    const { style, type, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('citations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (style) {
      query = query.eq('citation_style', style);
    }

    if (type) {
      query = query.eq('citation_type', type);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    res.json({
      citations: data,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('Error fetching citation history:', error);
    res.status(500).json({ error: 'Failed to fetch citation history' });
  }
}

// Get a specific citation
export async function getCitation(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('citations')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Citation not found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error fetching citation:', error);
    res.status(500).json({ error: 'Failed to fetch citation' });
  }
}

// Update a citation
export async function updateCitation(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { citationType, citationStyle, sourceData } = req.body;

    // If source data or style changed, regenerate citation
    let formattedCitation;
    if (sourceData && citationType && citationStyle) {
      formattedCitation = generateCitation(citationType, citationStyle, sourceData);
    }

    const updateData = {
      ...(citationType && { citation_type: citationType }),
      ...(citationStyle && { citation_style: citationStyle }),
      ...(sourceData && { source_data: sourceData }),
      ...(formattedCitation && { formatted_citation: formattedCitation }),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('citations')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: 'Citation not found' });
    }

    res.json(data);

  } catch (error) {
    console.error('Error updating citation:', error);
    res.status(500).json({ error: 'Failed to update citation' });
  }
}

// Delete a citation
export async function deleteCitation(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const { error } = await supabase
      .from('citations')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    res.json({ message: 'Citation deleted successfully' });

  } catch (error) {
    console.error('Error deleting citation:', error);
    res.status(500).json({ error: 'Failed to delete citation' });
  }
}

// Create a citation project
export async function createProject(req, res) {
  try {
    const userId = req.user.id;
    const { projectName, description, defaultStyle = 'MLA' } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const { data, error } = await supabase
      .from('citation_projects')
      .insert({
        user_id: userId,
        project_name: projectName,
        description,
        default_style: defaultStyle
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json(data);

  } catch (error) {
    console.error('Error creating citation project:', error);
    res.status(500).json({ error: 'Failed to create citation project' });
  }
}

// Get user's citation projects
export async function getProjects(req, res) {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('citation_projects')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    res.json(data);

  } catch (error) {
    console.error('Error fetching citation projects:', error);
    res.status(500).json({ error: 'Failed to fetch citation projects' });
  }
}

// Export citations in a project as a bibliography
export async function exportBibliography(req, res) {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const { format = 'text' } = req.query; // 'text', 'json', 'bibtex'

    // Get project and verify ownership
    const { data: project, error: projectError } = await supabase
      .from('citation_projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', userId)
      .single();

    if (projectError || !project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get all citations in the project
    const { data: projectCitations, error: citationsError } = await supabase
      .from('project_citations')
      .select(`
        citation_id,
        citations (*)
      `)
      .eq('project_id', projectId);

    if (citationsError) {
      throw citationsError;
    }

    const citations = projectCitations.map(pc => pc.citations);

    // Format based on requested format
    let output;
    if (format === 'json') {
      output = JSON.stringify(citations, null, 2);
    } else if (format === 'bibtex') {
      // Convert to BibTeX format (simplified)
      output = citations.map((c, index) => {
        return `@${c.citation_type}{citation${index + 1},\n  ${Object.entries(c.source_data).map(([key, value]) => `${key}={${value}}`).join(',\n  ')}\n}`;
      }).join('\n\n');
    } else {
      // Plain text bibliography
      output = citations.map(c => c.formatted_citation).join('\n\n');
    }

    res.set('Content-Type', format === 'json' ? 'application/json' : 'text/plain');
    res.send(output);

  } catch (error) {
    console.error('Error exporting bibliography:', error);
    res.status(500).json({ error: 'Failed to export bibliography' });
  }
}
