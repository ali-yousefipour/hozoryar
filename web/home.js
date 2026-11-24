// Preserve old bookmarked panel routes when the public home becomes the entry page.
if(location.hash && !['#main','#capabilities','#start','#questions'].includes(location.hash)){
  location.replace('/login'+location.hash);
}
