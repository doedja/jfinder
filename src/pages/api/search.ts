import type { APIRoute } from 'astro';
import { z } from 'zod';
import { taskManager } from '../../lib/tasks/task-manager';
import { processTopicSearch, processDOISearch } from '../../lib/tasks/task-processor';
import { parseYearFilter } from '../../lib/types';
import { parseDOIList } from '../../lib/utils/file-utils';
import { env } from '../../lib/env';

const searchSchema = z.object({
  topic: z.string().optional(),
  cycles: z.coerce.number().min(1).max(20).default(3),
  papers: z.coerce.number().min(1).max(250).default(20),
  yearFilter: z.string().optional(),
  downloadType: z.enum(['full', 'metadata']).default('full')
});

export const POST: APIRoute = async ({ request }) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    let topic: string | undefined;
    let doiList: string[] | undefined;
    let cycles = 3;
    let papers = 20;
    let yearFilter: string | undefined;
    let downloadType: 'full' | 'metadata' = 'full';

    if (contentType.includes('multipart/form-data')) {
      // Handle file upload
      const formData = await request.formData();

      topic = formData.get('topic')?.toString();
      cycles = parseInt(formData.get('cycles')?.toString() || '3');
      papers = parseInt(formData.get('papers')?.toString() || '20');
      yearFilter = formData.get('yearFilter')?.toString();
      downloadType = (formData.get('downloadType')?.toString() || 'full') as 'full' | 'metadata';

      const doiFile = formData.get('doiFile');
      if (doiFile && doiFile instanceof File && doiFile.size > 0) {
        // Check file size
        if (doiFile.size > env.MAX_UPLOAD_SIZE) {
          return new Response(
            JSON.stringify({ error: 'File too large' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Check file type
        if (!doiFile.name.endsWith('.txt')) {
          return new Response(
            JSON.stringify({ error: 'Only .txt files are allowed' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const content = await doiFile.text();
        doiList = parseDOIList(content);

        if (doiList.length === 0) {
          return new Response(
            JSON.stringify({ error: 'No valid DOIs found in file' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    } else {
      // Handle JSON body
      const body = await request.json();
      const parsed = searchSchema.safeParse(body);

      if (!parsed.success) {
        return new Response(
          JSON.stringify({ error: 'Invalid request', details: parsed.error.issues }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      topic = parsed.data.topic;
      cycles = parsed.data.cycles;
      papers = parsed.data.papers;
      yearFilter = parsed.data.yearFilter;
      downloadType = parsed.data.downloadType;
    }

    // Validate we have either topic or DOI list
    if (!topic && !doiList) {
      return new Response(
        JSON.stringify({ error: 'Either topic or DOI list is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Clamp values
    cycles = Math.min(Math.max(cycles, 1), 20);
    papers = Math.min(Math.max(papers, 1), 250);

    // Create task
    const taskId = taskManager.createTask(papers, cycles);

    // Start processing in background (don't await)
    if (doiList) {
      processDOISearch({
        taskId,
        dois: doiList,
        downloadType
      }).catch(err => {
        console.error('DOI search error:', err);
        taskManager.failTask(taskId, 'Processing failed');
      });
    } else if (topic) {
      processTopicSearch({
        taskId,
        topic,
        cycles,
        papers,
        yearFilter: parseYearFilter(yearFilter),
        downloadType
      }).catch(err => {
        console.error('Topic search error:', err);
        taskManager.failTask(taskId, 'Processing failed');
      });
    }

    return new Response(
      JSON.stringify({ taskId }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Search endpoint error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
