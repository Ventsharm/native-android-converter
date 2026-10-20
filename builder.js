(function (root) {
  'use strict';
  const API = 'https://api.github.com';
  const WORKFLOW = 'native-android-convert.yml';
  const WORKFLOW_PATH = '.github/workflows/' + WORKFLOW;
  const MARKER = '# Ventsharm Native Android Converter v1';
  const MAX_ZIP = 30 * 1024 * 1024;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const encode = encodeURIComponent;
  function validModule(value) { return /^[A-Za-z][A-Za-z0-9_-]*$/.test(value); }
  function validProject(file) {
    if (!file || !/\.zip$/i.test(file.name)) throw new Error('Choose a ZIP containing one AAB or a native Android source project.');
    if (file.size < 22 || file.size > MAX_ZIP) throw new Error('The ZIP must be between 22 bytes and 30 MB.');
  }
  function repoPath(owner, repo) { return '/repos/' + encode(owner) + '/' + encode(repo); }
  function encodeText(text) { return btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join('')); }
  function decodeText(text) { return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/\s/g, '')), char => char.charCodeAt(0))); }
  async function request(token, path, options = {}) {
    const response = await fetch(API + path, {
      ...options, cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'GitHub rejected the token. Check its expiry and permissions.' :
        response.status === 403 ? 'GitHub denied access. The token needs Actions, Contents and Workflows: Read and write for your private repository.' :
        response.status === 404 ? 'GitHub could not access that repository or workflow. Check the token’s selected repository.' :
        `GitHub request failed (${response.status}). ${data?.message || ''}`);
      error.status = response.status; throw error;
    }
    return data;
  }
  async function ownedPrivateRepos(token, user) {
    const result = [];
    for (let page = 1; ; page++) {
      const batch = await request(token, `/user/repos?visibility=private&affiliation=owner&per_page=100&page=${page}`);
      result.push(...batch.filter(repo => repo.private && !repo.archived && repo.owner?.login === user && repo.permissions?.push));
      if (batch.length < 100) break;
    }
    return result;
  }
  async function ensureWorkflow(token, owner, repo, branch, source) {
    if (!source.startsWith(MARKER)) throw new Error('The native converter workflow template could not be verified.');
    const path = repoPath(owner, repo) + '/contents/' + WORKFLOW_PATH;
    let old;
    try { old = await request(token, path + '?ref=' + encode(branch)); }
    catch (error) { if (error.status !== 404) throw error; }
    if (old) {
      const text = decodeText(old.content || '');
      if (!text.startsWith(MARKER)) throw new Error('A different workflow already uses this name. It was not overwritten.');
      if (text === source) return;
    }
    const body = { message: 'Install Native Android Converter workflow', content: encodeText(source), branch };
    if (old) body.sha = old.sha;
    await request(token, path, { method: 'PUT', body: JSON.stringify(body) });
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      try { if ((await request(token, repoPath(owner, repo) + '/actions/workflows/' + WORKFLOW)).state === 'active') return; }
      catch (error) { if (error.status !== 404) throw error; }
    }
    throw new Error('GitHub saved the workflow but has not registered it yet. Wait a moment and try again.');
  }
  function encodeBytes(bytes) {
    const chunks=[];
    for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    return btoa(chunks.join(''));
  }
  async function uploadProject(token, owner, repo, branch, id, file) {
    const path=repoPath(owner,repo);
    const release=await request(token,path+'/releases',{method:'POST',body:JSON.stringify({
      tag_name:'native-convert-input-'+id,target_commitish:branch,
      name:'Native Android convert input '+id,draft:true,
      body:'Temporary private Native Android Converter upload; preparation in progress.'
    })});
    try {
      // uploads.github.com rejects browser preflight requests. Git blobs use the
      // CORS-enabled API, without adding the ZIP to any branch or commit history.
      const blob=await request(token,path+'/git/blobs',{method:'POST',body:JSON.stringify({
        encoding:'base64',content:encodeBytes(new Uint8Array(await file.arrayBuffer()))
      })});
      if(!/^[a-f0-9]{40}$/.test(blob.sha))throw new Error('GitHub returned an invalid upload identifier.');
      const manifest={converter:'native-android-input-v2',build_id:id,blob_sha:blob.sha,size:file.size};
      await request(token,path+'/releases/'+release.id,{method:'PATCH',body:JSON.stringify({body:JSON.stringify(manifest)})});
      return {release,asset:{id:blob.sha}};
    } catch(error) {
      await request(token,path+'/releases/'+release.id,{method:'DELETE'}).catch(()=>{});
      if(error instanceof TypeError)throw new Error('The ZIP could not reach GitHub. Reload the converter and check your connection before trying again.');
      throw error;
    }
  }
  async function locateRun(token, owner, repo, branch, id) {
    for (let i = 0; i < 40; i++) {
      const runs = await request(token, repoPath(owner, repo) + `/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=${encode(branch)}&per_page=50`);
      const run = runs.workflow_runs.find(run => run.display_title === 'Native Android Converter — ' + id);
      if (run) return run;
      await sleep(2000);
    }
    throw new Error('GitHub accepted the build but has not listed it yet. Open your private repository’s Actions tab.');
  }
  async function signedArtifact(token, owner, repo, runId, id) {
    const data = await request(token, repoPath(owner, repo) + `/actions/runs/${runId}/artifacts?per_page=100`);
    const artifact = data.artifacts.find(item => !item.expired && item.name === 'signed-android-' + id);
    if (!artifact) throw new Error('The signed download is unavailable or has expired. Open the GitHub run to check its artifacts.');
    return artifact;
  }
  const helpers = { validModule, validProject, request, ownedPrivateRepos, ensureWorkflow, uploadProject, locateRun, signedArtifact, encodeBytes, MAX_ZIP };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!root.document) return;
  const $ = id => document.getElementById(id);
  let account, repositories = [], active = false, connectedToken = '';
  const status = (message, type = '') => { $('status').textContent = message; $('status').className = 'status ' + type; };
  $('connect').addEventListener('click', async () => {
    if (active) return;
    const token = $('token').value.trim();
    if (!token) { status('Enter your GitHub token first.', 'error'); return; }
    $('connect').disabled = true; $('repository').disabled = true;
    try {
      status('Connecting directly to GitHub…');
      account = await request(token, '/user');
      repositories = await ownedPrivateRepos(token, account.login);
      $('repository').replaceChildren(new Option('Choose your private builder repository', ''));
      for (const repo of repositories) $('repository').add(new Option(repo.full_name, repo.name));
      $('repository').disabled = false; connectedToken = token;
      status(repositories.length ? `Connected as ${account.login}. Choose the private repository containing your signing secrets.` : 'No writable private repositories were available to this token.');
    } catch (error) { status(error.message, 'error'); }
    finally { $('connect').disabled = false; }
  });
  $('forget').addEventListener('click', () => {
    if (active) return;
    $('token').value = ''; connectedToken = ''; account = null; repositories = [];
    $('repository').replaceChildren(new Option('Connect to GitHub first', '')); $('repository').disabled = true;
    $('download').hidden = true; $('download').onclick = null; status('Token forgotten. Nothing was saved in browser storage.');
  });
  $('buildForm').addEventListener('submit', async event => {
    event.preventDefault(); if (active || !$('buildForm').reportValidity()) return;
    const token = $('token').value.trim(), name = $('repository').value, moduleName = $('module').value.trim(), file = $('source').files[0];
    let uploaded, dispatched = false;
    try {
      if (!account || token !== connectedToken) throw new Error('Connect again after changing your token.');
      validProject(file); if (!validModule(moduleName)) throw new Error('Use a simple app module name, normally app.');
      const repo = repositories.find(repo => repo.name === name);
      if (!repo?.private) throw new Error('Choose your own private builder repository.');
      active = true; for (const id of ['build', 'connect', 'forget', 'token', 'repository', 'source', 'module', 'trusted']) $(id).disabled = true;
      $('download').hidden = true; $('download').onclick = null; $('runLink').hidden = true; $('cleanup').hidden = true; $('steps').textContent = '';
      const owner = account.login, branch = repo.default_branch, id = crypto.randomUUID().replace(/-/g, '');
      status('Installing the separate native converter workflow…');
      const response = await fetch('./workflow.yml', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load the native converter workflow. Reload the page.');
      await ensureWorkflow(token, owner, name, branch, await response.text());
      status('Uploading your source ZIP to a temporary draft release in your private repository…');
      uploaded = await uploadProject(token, owner, name, branch, id, file);
      $('cleanup').href = uploaded.release.html_url; $('cleanup').hidden = false;
      status('Starting the native conversion…');
      await request(token, repoPath(owner, name) + `/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: branch,
        inputs: { build_id: id, release_id: String(uploaded.release.id), asset_id: String(uploaded.asset.id), app_module: moduleName } }) });
      dispatched = true;
      const run = await locateRun(token, owner, name, branch, id);
      $('runLink').href = run.html_url; $('runLink').hidden = false;
      for (let i = 0; i < 600; i++) {
        const current = await request(token, repoPath(owner, name) + '/actions/runs/' + run.id);
        const jobs = await request(token, repoPath(owner, name) + `/actions/runs/${run.id}/jobs?per_page=100`);
        $('steps').textContent = jobs.jobs.map(job => `${job.name}: ${job.conclusion || job.status}\n` + (job.steps || []).filter(step => step.status === 'in_progress').map(step => '  ' + step.name).join('\n')).join('\n');
        if (current.status === 'completed') {
          if (current.conclusion !== 'success') throw new Error('The build did not complete successfully. Open the GitHub build above for the failed step. Your existing signing secrets were not changed.');
          const artifact = await signedArtifact(token, owner, name, run.id, id);
          $('cleanup').hidden = true;
          $('download').onclick = async () => {
            $('download').disabled = true;
            try {
              const result = await fetch(API + repoPath(owner, name) + `/actions/artifacts/${artifact.id}/zip`, {
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store', referrerPolicy: 'no-referrer'
              });
              if (!result.ok) throw new Error('The download could not be opened here. Use the GitHub build link and download its signed artifact.');
              const url = URL.createObjectURL(await result.blob()), link = document.createElement('a');
              link.href = url; link.download = 'signed-android-' + id + '.zip'; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (error) { status(error.message, 'error'); }
            finally { $('download').disabled = false; }
          };
          $('download').hidden = false;
          status('Your signed APK and AAB are ready. Download the ZIP below. The same private signing key was used for both.', 'success');
          return;
        }
        status('Converting and signing in GitHub Actions. Keep this tab open, or use the GitHub link to return to your build.');
        await sleep(10000);
      }
      throw new Error('The build is still running. Follow the GitHub link to check it and download the signed artifact when ready.');
    } catch (error) {
      if (uploaded && !dispatched) await request(token, repoPath(account.login, name) + '/releases/' + uploaded.release.id, { method: 'DELETE' }).catch(() => {});
      status(error instanceof TypeError ? 'The browser could not reach GitHub. Reload the converter and try again. If a build link is shown, check it before starting another build.' : error.message, 'error');
    } finally {
      active = false; for (const id of ['build', 'connect', 'forget', 'token', 'repository', 'source', 'module', 'trusted']) $(id).disabled = false;
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
