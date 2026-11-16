import React from 'react';

export default class WorkspaceBoundary extends React.Component {
 state={failed:false};

 static getDerivedStateFromError(){
  return {failed:true};
 }

 componentDidUpdate(previous){
  if(this.state.failed&&previous.resetKey!==this.props.resetKey)this.setState({failed:false});
 }

 render(){
  if(!this.state.failed)return this.props.children;
  if(this.props.hiddenOnError)return null;
  return <section className="panel" aria-label="Falha no painel">
   <p role="alert">Não foi possível abrir esta tela do painel.</p>
   <div className="quick-actions">
    <button type="button" onClick={()=>this.setState({failed:false})}>Tentar novamente</button>
    {this.props.onOverview?<button type="button" className="secondary"
      onClick={()=>{this.setState({failed:false});this.props.onOverview();}}>Ir para Visão Geral</button>
      :<a href="/app/">Abrir Visão Geral</a>}
   </div>
  </section>;
 }
}
