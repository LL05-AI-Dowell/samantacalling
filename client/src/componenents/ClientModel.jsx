



import React from 'react'

function ClientModel({message, isCalled, endCall}) {
  return (
    <div
    className={` ${isCalled ? "flex": "hidden"} flex-col w-screen h-screen fixed top-0 left-0 items-center justify-center`}
    >
      <div
      className='flex flex-col bg-gray-500 p-10 py-20 rounded-xl space-y-10'
      >
        <div
        className='text-2xl'
        >{message}</div>
        <div>
          <button
          onClick={endCall}
          >End Call</button>
        </div>
      </div>
    </div>
  )
}

export default ClientModel