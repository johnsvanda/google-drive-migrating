const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const async = require("async");

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/drive"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = "token.json";

// Load client secrets from a local file.
fs.readFile("credentials.json", (err, content) => {
  if (err) return console.log("Error loading client secret file:", err);
  // Authorize a client with credentials, then call the Google Drive API.
  authorize(JSON.parse(content), listFiles);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question("Enter the code from that page here: ", code => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
        if (err) return console.error(err);
        console.log("Token stored to", TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * Lists the names and IDs of up to 10 files.
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listFiles(auth) {
  const copy = "1zahClNLyNypeoD0y1mqFcklGFAz48SX6"; // Folder to copy from
  const paste = "1_VT6jD3SGlM8qn_B_sFgGlz95snYLc9M"; // Folder to paste into
  var pageToken = null;
  const drive = google.drive({ version: "v3", auth });

  copyFolder(copy, paste, drive, pageToken);
  moveFile(copy, paste, drive, pageToken);
}

function copyFolder(oldParent, newParent, drive, pageToken) {
  async.doWhilst(
    function(callback) {
      // Folders
      drive.files.list(
        {
          q: `mimeType = 'application/vnd.google-apps.folder' and '${oldParent}' in parents and trashed = false`, // viewedByMeTime > '2020-02-05T14:00:00'
          fields: "nextPageToken, files(id, name, permissions)",
          spaces: "drive",
          pageToken: pageToken
        },
        function(err, res) {
          if (err) {
            // Handle error
            console.error(err);
            callback(err);
          } else {
            res.data.files.forEach(function(oldFolder) {
              console.log(
                "Found folder: ",
                oldFolder.id,
                oldFolder.name,
                oldFolder.permissions
              );

              drive.files.list(
                {
                  q: `mimeType = 'application/vnd.google-apps.folder' and '${newParent}' in parents and name = '${oldFolder.name}' and trashed = false`,
                  fields: "nextPageToken, files(id, name)",
                  spaces: "drive",
                  pageToken: pageToken
                },
                function(err, res) {
                  if (err) {
                    // This step never happens
                  } else if (res.data.files.length !== 0) {
                    // If folder exists continue searching what's changed
                    res.data.files.forEach(function(createdFolder) {
                      moveFile(
                        oldFolder.id,
                        createdFolder.id,
                        drive,
                        pageToken
                      );
                      copyFolder(
                        oldFolder.id,
                        createdFolder.id,
                        drive,
                        pageToken
                      );
                    });
                  } else {
                    // If folder doesn't exists create new folder
                    var fileMetadata = {
                      name: oldFolder.name,
                      permissions: oldFolder.permissions[1],
                      mimeType: "application/vnd.google-apps.folder",
                      parents: [newParent]
                    };

                    drive.files.create(
                      {
                        resource: fileMetadata,
                        fields: "id, name"
                      },
                      function(err, res) {
                        if (err) {
                          console.error(err);
                        } else {
                          console.log(
                            "Creating copy of folder: " +
                              JSON.stringify(res.data.name)
                          );
                          moveFile(oldFolder.id, res.data.id, drive, pageToken);
                          copyFolder(
                            oldFolder.id,
                            res.data.id,
                            drive,
                            pageToken
                          );
                        }
                      }
                    );
                  }
                }
              );
            });
            pageToken = res.nextPageToken;
            callback();
          }
        }
      );
    },
    function() {
      return !!pageToken;
    },
    function(err) {
      if (err) {
        // Handle error
        console.error(err);
      } else {
        // All pages fetched
      }
    }
  );
}

function moveFile(oldParent, newParent, drive, pageToken) {
  // Finding file
  var pageToken = null;
  drive.files.list(
    {
      q: `mimeType != 'application/vnd.google-apps.folder' and '${oldParent}' in parents and trashed = false`, //and (viewedByMeTime > '2020-02-07T14:00:00')
      fields: "nextPageToken, files(id, name, parents)",
      spaces: "drive",
      pageToken: pageToken
    },
    function(err, res) {
      if (err) {
        console.error(err);
      } else {
        res.data.files.forEach(function(file) {
          console.log("Found file: ", file.id, file.name, file.parents);

          // Moving file
          var previousParents = file.parents.join(",");
          drive.files.update(
            {
              fileId: file.id,
              addParents: newParent,
              removeParents: previousParents,
              fields: "id, parents"
            },
            function(err, file) {
              if (err) {
                // Handle error
              } else {
                // File moved.
                console.log("File moved.");
              }
            }
          );
        });
      }
    }
  );
}
