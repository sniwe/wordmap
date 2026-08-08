1
when child subSeg line-initial content is subString within linked paretn langUnit string, let auto-langUnit apply

2
-

we are to set up a "runStudy" routine tirggered by the studyBtn already on the page (which currently has no function/action attached); 

this will require an in-depth phased vertical tracer bullet implementation (generated to output destination C:\retry\mgmt\dev\260807) made according to the specifications below. note that the specifications define a limited early version of the study functionality that will be enhanced and expanded in scope in later dev:

studyBtn will be disabled by default. audEp cycle target of an audEp will enable the button. if cycle target index reverts to -1 at any point, the button state reverts to disabled;
click studyBtn to initiate study routine.
upon initiation, studyRuns collection latest item is checked for incomplete run item. if exists, run that skipping complete portion of it. else init new.
init new will first build the study session data and its stages, which are to initially include: 1) disambiguated chinFuzz lateral defuzz. this involves: a) scanning subSegs and langUnits of the target audEp to identify instances where a chinFuzz langUnit has a disambiguation selection on its linked subSeg child. that is, if the linked child subSeg contains a langUnit preceded by an "=" sign (the marker used by the user to mark a selection from possible multiple candidate langUnits on the subSeg content); b) identifying instances of the same pre-disam selection string across all subSegs of the current audEp. for example, subSeg of id "767e5d96-9f62-45f4-89a5-f98c43303144-0-0" has content "我们从一条预警说起，关于eerninuo" with chinFuzz langUnit on "eerninuo". child subSeg under that langUnit has selected candidate langUnit "厄尔尼诺" (preceded by "=" marking it as such). thus, if any other subSegs under that audEp contain "eerninuo" on their content which are not yet langUnit captured or part of an exisitng langUnit, these are targets for identification; c) 
