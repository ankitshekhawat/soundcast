//Audiodevice by http://whoshacks.blogspot.com/2009/01/change-audio-devices-via-shell-script.html

//Settings
const port = '7531';
const caption = 'Soundcast';
const bitrate = '320';

//Shell and filesystem dependencies
const path = require('path');
const child = require('child_process')

//Electron dependencies
const menubar = require('menubar');
const electron = require('electron');
const {app, Menu, MenuItem, dialog} = electron;
const mb = menubar({dir: __dirname, icon: 'not-castingTemplate.png'});
//Pointer to the chromecast-osx-audio process
var chromecastProcess;

// For debugging purposes, store the JSON with all the devices
var devicesJson;

//Indicates if the user reset the OSX selected sound adapters
var adapter_reset = false;
var selected_device;

//Stores sound input device in use before starting soundcast
var original_input;
/*getDevice('input', function(data) {
  original_input = data;
});*/

//Stores sound output device in use before starting soundcast
var original_output;
getDevice('output', (data) => {
  original_output = data;
});

function execAsync(path, args, stdio) {
  console.log(path);
  let options = {detached: true};
  if (stdio !== undefined) {
    options.stdio = stdio;
  }

  let proc = child.spawn(path, args, options);

  proc.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
  });

  return proc;
}

function exec(path, args, callback) {
  console.log(path);
  let proc = child.spawn(path, args, {detached: true});
  let stdout, stderr;

  proc.stdout.on('data', (data) => {
    stdout = data.toString();
  });

  proc.stderr.on('data', (data) => {
    stderr = data.toString();
  });

  proc.on('close', (code) => {
    console.log(`child process exited with code ${code}`);
    callback(code, stdout, stderr);
  });

  return proc;
}

//Gets OSX currently selected sound device
function getDevice(which, callback) {
  execAsync(path.join(__dirname, '/audiodevice'), [which]).stdout.on('data', function(data) {
    callback(data.toString().replace(/(\r\n|\n|\r)/gm,""));
  });
}
//Sets OSX selected sound device
function setDevice(which, what) {
  execAsync(path.join(__dirname, '/audiodevice'), [which, what]);
}

//Gets available chromecast-osx-audio
function getChromecasts(callback) {
  //TODO: This dirty workaround should be fixed after updating chromecast-osx-audio module to break if no chromecast is found
  exec(path.join(__dirname,'/node'), [path.join(__dirname,'/node_modules/chromecast-osx-audio/bin/chromecast.js'), '-j'], function (error, stdout, stderr) {
    if (stdout) {
      devicesJson = stdout;
      let chromecasts = JSON.parse(stdout);
      callback(chromecasts);
    }
  });
}

function stopCasting(output_device, input_device, going_to_sleep) {
  if (going_to_sleep !== true) {
    selected_device = undefined;
  }

  //Enables "Start casting" and disables "Stop casting" options
  for(var j=0; j<castmenu.items.length; j++) {
    castmenu.items[j].enabled = true;
  }
  menu.items[1].enabled = false;
  //Changes tray icon to "Not casting"
  mb.tray.setImage(path.join(__dirname,'not-castingTemplate.png'));
  //Changes OSX selected audio devices back to their original selections
  setDevice('output', output_device);
  //setDevice('input', input_device);
  //Kills chromecast subprocess
  if(chromecastProcess){
    chromecastProcess.kill();
    chromecastProcess = undefined;
  }
}

app.on('ready', () => {
  electron.powerMonitor.on('suspend', () => {
    console.log('The system is going to sleep');
    stopCasting(original_output, original_input, true);
  });

  electron.powerMonitor.on('resume', () => {
    console.log('The system is waking up');
    // Refresh Chromecasts
    mb.emit('ready');
  });
});

app.on('quit', () => {
  //Only change back to original values if adapters where not reset
  if(!adapter_reset){
    setDevice('output', original_output);
    //setDevice('input', original_input);
  }

  //Kill chromecast subprocess if it exists
  if(chromecastProcess) {
    chromecastProcess.kill();
    chromecastProcess = undefined;
  }
});

function getScanningMenu() {
  //Menu startup message
  menu = new Menu();
  menu.append(new MenuItem({
    label: 'Scanning for Chromecasts...'
  }));

  return menu;
}

//Menubar construction
mb.on('ready', function ready() {
  mb.tray.setContextMenu(getScanningMenu());

  //Scan for Chromecasts and populate menus
  getChromecasts((chromecasts) => {
    let item_to_select;

    //Reset menu to delete startup message
    menu = new Menu();
    castmenu = new Menu();

    for (var i in chromecasts) {
      let chromecast = chromecasts[i];
      let label = chromecast.txtRecord.fn;
      let name = chromecast.name;
      console.log('Found Chromecast: ', label);

      if (chromecast.txtRecord.md === 'Chromecast Audio') {
        label += ' ' + String.fromCharCode('0xD83D','0xDD0A');
      }

      let item = new MenuItem({
        label: label,
        click: (current) => {
          //Disables "Start casting" options
          for(var j=0; j<castmenu.items.length; j++) {
            castmenu.items[j].enabled = false;
          }
          //Enables "Stop casting"
          menu.items[1].enabled = true;

          //Changes tray icon to "Casting"
          mb.tray.setImage(path.join(__dirname, 'castingTemplate.png'));

          //Sets OSX selected input and output audio devices to Soundflower
          setDevice('output','Soundflower (2ch)');
          //setDevice('input','Soundflower (2ch)');

          //Spawns new subprocess that bridges system audio to the selected chromecast
          //We use a custom node binary because the chromecast-osx-audio module only works
          //on node v0.10.x
          chromecastProcess = execAsync(path.join(__dirname, '/node'),
                                    [path.join(__dirname, '/node_modules/chromecast-osx-audio/bin/chromecast.js'),
                                    '-b', bitrate,
                                    '-n', caption,
                                    '-p', port,
                                    '-d', name], 'inherit');

          // Remember the selected device
          selected_device = name;
        }
      });

      castmenu.append(item);

      if (selected_device === chromecast.name) {
        item_to_select = item;
      }
    }

    //Refresh
    castmenu.append(new MenuItem({type: 'separator'}));
    castmenu.append(new MenuItem({
      label: 'Refresh Chromecasts',
      click: () => {
        mb.emit('ready');
      }
    }));

    //Changes tray icon to "Not casting" (this is redundant but, for some reason,
    //the packaged app doesn't apply the constructor given icon parameter
    mb.tray.setImage(path.join(__dirname,'not-castingTemplate.png'));
    //Clicking this option starts casting audio to Chromecast
    menu.append(new MenuItem({
      label: 'Cast to',
      submenu: castmenu
    }));

    //Clicking this option stops casting audio to Chromecast
    menu.append(new MenuItem({
      label: 'Stop casting',
      click: () => {
        stopCasting(original_output, original_input);
      }
    }));

    menu.append(new MenuItem({type: 'separator'}));

    /*Clicking this option resets OSX selected audio devices to internal
    this is necessary when something goes wrong and OSX selected audio devices
    are not changed back to original values and stay stuck in Soundflower*/
    menu.append(new MenuItem({
      label: 'Reset audio adapter',
      click: () => {
        /*Remember this option was clicked, so it isn' changed back to Soundflower
        when quiting*/
        adapter_reset = true;
        stopCasting('internal', 'internal');
      }
    }));

    //Clicking this option shows an 'About' dialog
    menu.append(new MenuItem({
      label: 'About',
      click: () => {
        dialog.showMessageBox({
          title: 'About',
          message: 'SoundCast v1.8. Created by Andres Gottlieb.',
          detail: 'https://www.github.com/andresgottlieb/soundcast',
          buttons: ["OK"]
        });
      }
    }));

    //Clicking this option shows a 'Device logs' dialog
    menu.append(new MenuItem({
      label: 'Device logs',
      click: () => {
        dialog.showMessageBox({
          title: 'Device logs',
          message: 'Devices found on this system:',
          detail: devicesJson,
          buttons: ["OK"]
        });
      }
    }));

    //Clicking this option quits the soundcast app
    menu.append(new MenuItem({
      label: 'Quit',
      click: () => {
        //Quit the app
        mb.app.quit();
      }
    }));

    //Start with "Stop casting" option disabled
    menu.items[1].enabled = false;

    //Enable the tray
    mb.tray.setContextMenu(menu);

    // Automatic reconnection
    if (item_to_select !== undefined) {
      console.log("Reconnecting to: " + item_to_select.label);
      item_to_select.click();
    }
  });
});
