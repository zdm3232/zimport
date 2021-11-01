
/*
  Show progress bar across top of screen
*/
function zImportProgress( content, pct )
{
  const loader = document.getElementById("loading");
  pct = parseInt( pct * 100 );
  pct = Math.clamped( pct, 0, 100 );
  loader.querySelector("#context").textContent = content;
  loader.querySelector("#loading-bar").style.width = `${pct}%`;
  loader.querySelector("#progress").textContent = `${pct}%`;
  loader.style.display = "block";
  if ( (pct === 100 ) && !loader.hidden) $(loader).fadeOut(2000);
}

function zImportProgressDone()
{
  const loader = document.getElementById("loading");
  $(loader).fadeOut(2000);
}

/*
  Simple notification error
*/
function zError( msg )
{
  ui.notifications.error( `zDnD: ${msg}` );
}

/*
  Import folders.json from obsidian export
  All matching is based on the flags.zdnd.id field, so will update same id folder and re-use.
  Also build a map of this id to the actual folder so journals can be created in correct folders.
  Parent relationship is in flags.zdnd.pid which is also used to create folder hierarchy
*/
async function zImportFolders( folderFile, folders )
{
  console.log( "zDnD: zImportFolders " + folderFile );

  let folderData = await fetch( folderFile );
  if ( !folderData.ok ) {
    zError( "cannot open file: " + folderFile + ', ' + folderData.statusText );
    return;
  }

  let count = 0;
  let folderContent = await folderData.json();
  let maxCount = folderContent.length;
  for ( let i of folderContent ) {
    if ( i.name === undefined ) {
      continue;
    }
    zImportProgress( "Import folders", count/maxCount );
    
    let folder = await game.folders.find( e => e.data.flags?.zdnd?.id === i.flags.zdnd.id );
    if ( folder ) {
      console.log( `Update folder ${i.name}` );
      await folder.update( i );
    } else {
      console.log( `Import folder ${i.name}` );
      folder = await Folder.create( i );
    }

    // update parent
    if ( folder.data.flags.zdnd.pid ) {
      let parent = await game.folders.find( e => e.data.flags?.zdnd?.id === folder.data.flags.zdnd.pid );
      if ( parent ) {
	await folder.update( { parent: parent.id } );
      }
    }

    // add to map
    await folders.set( folder.data.flags.zdnd.id, folder.id );
    count++;
  }

  ui.notifications.notify( `zDnD: done importing ${count} folders` );
  return folders;
}

/*
  Fix all links between journals
  Input is a map from flags.zdnd.id to actual journal object id
  Parse the html and find all elements with class of zlink.
  Replace all [zid=<flags.zdnd.id>] with [<object_id>].
*/
async function zImportJournalLink( journalMap, content )
{
  let html = $(`<div></div>`);
  html.html( content );

  let links = html.find( '[class^="zlink"]' );
  for ( let i = 0; i < links.length; i++ ) {
    let value = links[i].innerHTML;
    let matches = value.match( /\[zid=([^\]]+)\]/ );
    if ( matches ) {
      let id = journalMap.get( matches[1] );
      let swap = `zid=${matches[1]}`;
      links[i].innerHTML = value.replace( swap, `${id}` );
    }
  }
  return html.html();
}

/*
  Import journal entries from adv.json
  Input has a folder map to obtain folder id for where to put journal.
  Adds information to journalMap to map from flags.zdnd.id to actual journal object id
*/
async function zImportJournals( importFile, folders, journalMap )
{
  let advData = await fetch( importFile );
  if ( !advData.ok ) {
    zError( "cannot open file: " + importFile + ", " + advData.statusText );
    return;
  }

  // add existing journal entires in folders into journalMap
  // allows for quickly finding and updating if one exists
  for ( let i of folders ) {
    const folder = game.folders.get( i[1] );
    for ( let e = 0; e < folder.contents.length; e++ ) {
      let j = folder.contents[e];
      journalMap.set( j.data.flags.zdnd.id, j.id );
    }
  }

  let journals = [];
  let advContent = await advData.json();
  if ( Object.keys( advContent ).length === 0 ) {
    return;
  }
  let count = 0;
  let maxCount = advContent.length;
  for ( let i of advContent ) {
    zImportProgress( "Import Journals", count/maxCount );
    count++;

    if ( i.name === undefined ) {
      continue;
    }

    // resolve folder
    let folderId = folders.get( i.flags.zdnd.folder );
    if ( folderId === undefined ) {
      zError( `Folder missing for import of adventure ${i.folder} for journal ${i.name}` );
      continue;
    }
    i.folder = folderId;

    let jId = journalMap.get( i.flags.zdnd.id );
    let journal = game.journal.get( jId );
    if ( journal ) {
      console.log( `Update journal ${i.name}` );
      await journal.update( i );
    } else {
      console.log( `Import journal ${i.name}` );
      journal = await JournalEntry.create( i );
    }

    // add id to update
    journals.push( journal.id );
    journalMap.set( journal.data.flags.zdnd.id, journal.id );
  }

  // correct journal links
  // <div class=\"zlink\">@JournalEntry[zid=SmuggledGoods]{Smuggled Goods}</div>
  for ( let i=0; i < journals.length; i++ ) {
    let journal = game.journal.get( journals[i] );
    let str = await zImportJournalLink( journalMap, journal.data.content );
    journal.update( { content: str } );
  }

  ui.notifications.notify( `zDnD: done importing ${journals.length} journals` );
}

/*
  Import obsidian export directory
  Assume a folders.json to create folders and a adv.json for journals.
  Based on name passed it looks on server under imports/
*/
async function zImportAdventure( args )
{
  let arg = args.split( ' ' );
  let importDir = arg.length > 0 ? arg[1] : undefined;
  if ( !importDir ) {
    zError( 'No adventure import folder provided' );
    return;
  }

  let advDir = `imports/${importDir}`;
  let folderFile = `${advDir}/folders.json`;
  let importFile = `${advDir}/adv.json`;

  console.log( `zDnD: zImportAdventire ${importDir}` );
  ui.notifications.notify( `zDnD: importing adventure ${importDir}` );

  var folders = new Map();
  await zImportFolders( folderFile, folders );

  let journalMap = new Map();
  var journals = [];
  await zImportJournals( importFile, folders, journalMap );

  zImportProgressDone();

  ui.notifications.notify( `zDnD: done importing adventure ${importDir}` );
}

/*
  Create / command in chat message
*/
Hooks.on( "chatMessage", (log, content, data) => {
  if ( content.match( /^\/zobs/ ) ) {
    zImportAdventure( content );
    return false;
  }
  return true;
});



