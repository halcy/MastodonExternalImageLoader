// ==UserScript==
// @name         Mastodon load remote images
// @version      0.5
// @description  Load remote images from media-silenced instances locally
// @author       Xumbra and halcy
// @match        https://icosahedron.website/*
// @grant        none
// ==/UserScript==

(function() {
	'use strict';

  // Network loading and parsing
	function getData(resource, isHTML, auth) {
		return new Promise((resolve, reject) => {
			let request = new XMLHttpRequest();
			request.addEventListener("readystatechange", () => {
				if (request.readyState === 4 && request.status === 200) {
					if (isHTML == false) {
						let data = JSON.parse(request.responseText);
						resolve(data);
					} else {
						let parser = new DOMParser();
						let data = parser.parseFromString(request.responseText, "text/html");
						resolve(data);
					}
				} else if (request.readyState === 4) {
					reject("error getting resources");
				}
			});
			request.open("GET", resource);
			if (auth == true) {
				request.setRequestHeader('X-CSRF-Token', document.querySelector('meta[name=csrf-token]').content);
				request.setRequestHeader('Authorization', 'Bearer ' + JSON.parse(document.querySelector('[id=initial-state]').text).meta.access_token);
			}
			request.send();
		});
	}

  // Lightbox replacement
  var lightboxReplaceImage = "";
  var didReplace = false;
  function replaceLightbox() {    
    // Bail if no replacement requested
  	if(lightboxReplaceImage === "") {
     	lightboxReplaceImage = "";
    	return;
    }
    
    // See if we have a lightbox and if not, bail
    const lightboxDiv = document.querySelector("div.modal-root__modal");
    const lightboxImg = lightboxDiv.querySelector("img");
    if(!lightboxImg) {
      if(didReplace === true) {
      	 lightboxReplaceImage = ""; 
      }
    	return;
    }
    
    // Replace
    lightboxImg.src = lightboxReplaceImage;
    didReplace = true;
  }
  
	function loadThumbnails() {  
		const tag = "fetched-thumbnail"; // Class added to already loaded thumbnails
		const selector = `a[class=media-gallery__item-thumbnail]:not(.${tag})`
		const defaultImgStyle = "object-position: center top;";
		const linkParentSelector = ".media-gallery";
		const spoilerSelector = ".spoiler-button";
		document.querySelectorAll(selector).forEach(a => {
			// Bail if not media-reject (tested for by "has an onclick handler attached")
			if (!!a.onclick) {
				return;
			}
      
      // Also bail if not jp(e)g, png, gif or webp
      const fileName = a.href.toLowerCase();
      if (!(fileName.endsWith(".png") || fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileName.endsWith(".gif") || fileName.endsWith(".webp"))) {
       	return; 
      }
      
      // Set up for lightbox replacement
      a.onclick = function(){
        var lightboxElem;
        var foundElem = false;
        document.querySelectorAll(selector).forEach(lightboxLink => {
          if(foundElem === false) {
            if(!!lightboxLink.onclick) {
              lightboxElem = lightboxLink;
              foundElem = true;
            }
          }
        });
        lightboxReplaceImage = a.href;
        didReplace = false;
        lightboxElem.click();
        return false;
      };

			// Immediately add the "loaded" tag to avoid reprocessing if many events trigger quickly
			a.classList.add(tag);

			// Create new img tag
			const img = document.createElement("img");
			img.src = a.href.replace("original", "small");

			// Figure out the how-manyth child we are
			const galleryRoot = a.parentElement.parentElement;
			let imageIndex = 0;
			for (imageIndex = 1; imageIndex < 5; imageIndex++) {
				if (galleryRoot.children[imageIndex].firstChild.href == a.href) {
					break;
				}
			}
			imageIndex = imageIndex - 1;

			// Try to get the status ID
			let statusId;
			const parentContainer = galleryRoot.parentElement;

			// Figure out status ID (local) to get focus from API
			if (parentContainer.dataset.id !== undefined) {
				// timeline
				statusId = a.parentElement.parentElement.parentElement.dataset.id;
			} else {
				// single post view
				const linkWithId = parentContainer.querySelector(`a[class=detailed-status__datetime]`).href;
				const linkParts = linkWithId.split("/");
				statusId = linkParts[linkParts.length - 1];
			}

			// Query local instance to get focus point
			const statusUrl = "/api/v1/statuses/" + statusId;
			getData(statusUrl, false, true).then(data => {
				if (data.media_attachments[imageIndex].meta !== null) {
					const xoff = 100 - ((data.media_attachments[imageIndex].meta.focus.x + 1.0) * 0.5) * 100;
					const yoff = 100 - ((data.media_attachments[imageIndex].meta.focus.y + 1.0) * 0.5) * 100;
					img.style = `object-position: ${xoff}% ${yoff}%;`;
					a.replaceChildren(img);
				}

				// Avatar loading if first child by querying remote instance
				if (imageIndex === 0) {
					// Figure out whether we have pleroma or masto on the other side
					const userUrl = data.account.url;
					if (userUrl.includes("@")) {
						// @-URLs: Masto (unfortunately, lookup api does not work on pawoo, so we have to scrape profile page)
						getData(userUrl, true, false).then(userpageData => {
							parentContainer.querySelector(`div[class=account__avatar]`).firstChild.src = userpageData.querySelector(`img[id=profile_page_avatar]`).src;
						});
					} else {
						// Otherwise: Pleroma 
						const userName = data.account.username;
						const userHost = userUrl.split("//")[1].split("/")[0];
						const userInfoUrl = `https://${userHost}/api/v1/accounts/search?q=@${userName}`;
						getData(userInfoUrl, false, false).then(userData => {
							parentContainer.querySelector(`div[class=account__avatar]`).firstChild.src = userData[0].avatar;
						});
					}
				}

			}).catch(err => {
				console.error(err);
			});

			img.style = defaultImgStyle;
			a.replaceChildren(img);
			a.closest(linkParentSelector)?.querySelector(spoilerSelector)?.remove();
		});
	}
	let observer = new MutationObserver(loadThumbnails);
	observer.observe(document.body, {
		characterData: true,
		childList: true,
		subtree: true
	});
    
	let observerLightbox = new MutationObserver(replaceLightbox);
	observerLightbox.observe(document.body, {
		characterData: true,
		childList: true,
		subtree: true
	});    
})();
